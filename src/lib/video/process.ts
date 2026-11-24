import {
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  getThumbnailKey,
  getVideoDisplayKey,
} from "@/lib/r2/client";
import { recordUsage, secondsSince } from "@/lib/usage/record";
import { scrubSignedUrls } from "@/lib/net/scrub-urls";

/**
 * Bridge to the Modal video pipeline (modal/video_pipeline.py).
 *
 * The Modal function holds no credentials: we presign a GET for the original
 * and PUTs for everything it writes — the three poster variants (into the
 * normal thumbnails/{variant}/ scheme, so thumbnail_generated and all display
 * paths work unchanged) and, for .mov originals, the web-playable .mp4
 * rendition. ffprobe over there also validates codecs (H.264 / AAC-or-silent).
 *
 * Env:
 *   VIDEO_PIPELINE_URL — the deployed fastapi endpoint
 *                        (modal deploy modal/video_pipeline.py)
 *   VIDEO_PIPELINE_KEY — shared secret, matching the Modal `video-pipeline`
 *                        secret's VIDEO_PIPELINE_KEY
 */

export interface VideoProcessResult {
  /** false = clean rejection (unsupported codec) — not retryable. */
  ok: boolean;
  error?: string;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

export async function processVideoViaModal(
  r2Key: string,
  attribution?: { userId: string; eventId?: string | null }
): Promise<VideoProcessResult> {
  const url = process.env.VIDEO_PIPELINE_URL;
  if (!url) {
    throw new Error(
      "VIDEO_PIPELINE_URL is not configured — deploy modal/video_pipeline.py and set it"
    );
  }

  const displayKey = getVideoDisplayKey(r2Key);
  const [videoUrl, smPut, mdPut, lgPut, displayPut] = await Promise.all([
    getPresignedDownloadUrl(r2Key, 3600),
    getPresignedUploadUrl(getThumbnailKey(r2Key, "thumb-sm"), "image/jpeg", 3600),
    getPresignedUploadUrl(getThumbnailKey(r2Key, "thumb-md"), "image/jpeg", 3600),
    getPresignedUploadUrl(getThumbnailKey(r2Key, "thumb-lg"), "image/jpeg", 3600),
    displayKey === r2Key
      ? Promise.resolve(null)
      : getPresignedUploadUrl(displayKey, "video/mp4", 3600),
  ]);

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY ?? null,
      video_url: videoUrl,
      poster_puts: { sm: smPut, md: mdPut, lg: lgPut },
      display_put: displayPut,
    }),
  });

  if (!res.ok) {
    throw new Error(
      scrubSignedUrls(`Video pipeline failed: ${res.status} ${await res.text().catch(() => "")}`)
    );
  }

  // Awaited: this runs at the tail of an Inngest step — a void insert races
  // the invocation freeze and loses the row.
  if (attribution) {
    await recordUsage({
      userId: attribution.userId,
      eventId: attribution.eventId,
      kind: "video_process",
      quantity: secondsSince(started),
      unit: "seconds",
    });
  }

  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    duration_seconds?: number | null;
    width?: number | null;
    height?: number | null;
    has_audio?: boolean;
  };

  return {
    ok: json.ok,
    error: json.error,
    durationSeconds: json.duration_seconds ?? null,
    width: json.width ?? null,
    height: json.height ?? null,
    hasAudio: json.has_audio ?? false,
  };
}

export interface MutedVideoResult extends VideoProcessResult {
  /** The pipeline's own word that the rendition it wrote has no audio. */
  muted: boolean;
}

/**
 * A SILENT copy: the pipeline reads `source.url` (Scout's signed URL, already
 * vetted by the caller, so the clip with sound is never written to our
 * storage) and writes the web rendition, with every audio stream dropped, to
 * `destKey`, plus the three poster variants for `destKey`. Used by the Scout integration, whose
 * crew phone clips record conversations and client names: the audio is never
 * stored anywhere a gallery, download or the website can reach.
 *
 * Refuses (throws) unless the pipeline answers `muted: true`. An older
 * deployment of modal/video_pipeline.py ignores `mute` and would happily copy
 * the audio, and it never sends `muted`, so it fails here instead. The caller
 * still checks the written bytes itself (mp4-tracks.ts): this flag is the
 * pipeline's claim, not the proof.
 *
 * The upload URLs live only as long as this call may wait (plus a minute), so
 * a Modal run that outlives our timeout cannot write into the keys long after
 * the caller rolled them back. Deploy order matters: the Modal function before
 * the app, or an old deployment that ignores `mute` could, after a timeout,
 * write a copy WITH sound inside that window (the read-back never sees it).
 */
export async function processMutedVideoViaModal(
  source: { url: string },
  destKey: string,
  attribution?: { userId: string; eventId?: string | null },
  { timeoutMs = 240_000 }: { timeoutMs?: number } = {}
): Promise<MutedVideoResult> {
  const url = process.env.VIDEO_PIPELINE_URL;
  if (!url) {
    throw new Error(
      "VIDEO_PIPELINE_URL is not configured — deploy modal/video_pipeline.py and set it"
    );
  }
  if (!destKey.toLowerCase().endsWith(".mp4")) {
    throw new Error(`a muted rendition is written as .mp4, not ${destKey}`);
  }

  const putTtl = Math.ceil(timeoutMs / 1000) + 60;
  const [smPut, mdPut, lgPut, displayPut] = await Promise.all([
    getPresignedUploadUrl(getThumbnailKey(destKey, "thumb-sm"), "image/jpeg", putTtl),
    getPresignedUploadUrl(getThumbnailKey(destKey, "thumb-md"), "image/jpeg", putTtl),
    getPresignedUploadUrl(getThumbnailKey(destKey, "thumb-lg"), "image/jpeg", putTtl),
    getPresignedUploadUrl(destKey, "video/mp4", putTtl),
  ]);

  const started = Date.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY ?? null,
      video_url: source.url,
      poster_puts: { sm: smPut, md: mdPut, lg: lgPut },
      display_put: displayPut,
      mute: true,
    }),
    // A cold Modal container plus a 50 MB download and copy fits well inside;
    // a dead socket must not hold the request until the platform kills it.
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(scrubSignedUrls(`Video pipeline failed: ${res.status} ${await res.text().catch(() => "")}`));
  }

  if (attribution) {
    await recordUsage({
      userId: attribution.userId,
      eventId: attribution.eventId,
      kind: "video_process",
      quantity: secondsSince(started),
      unit: "seconds",
    });
  }

  const json = (await res.json()) as {
    ok: boolean;
    error?: string;
    duration_seconds?: number | null;
    width?: number | null;
    height?: number | null;
    has_audio?: boolean;
    muted?: boolean;
  };
  const result: MutedVideoResult = {
    ok: json.ok,
    error: json.error,
    durationSeconds: json.duration_seconds ?? null,
    width: json.width ?? null,
    height: json.height ?? null,
    hasAudio: json.has_audio ?? false,
    muted: json.muted === true,
  };
  if (result.ok && !result.muted) {
    throw new Error(
      "Video pipeline did not confirm a muted rendition — redeploy modal/video_pipeline.py (mute support, 2026-11-24)"
    );
  }
  return result;
}
