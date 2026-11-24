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
 * The silent-copy endpoint is missing: `VIDEO_MUTE_URL` is unset, or the
 * deployed Modal app has no `mute_video` endpoint (404). Retryable once the
 * deploy is done; the caller answers 503 and nothing is written.
 */
export class VideoMuteUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoMuteUnavailableError";
  }
}

/** True when the app knows where the silent-copy endpoint is. */
export function isVideoMuteConfigured(): boolean {
  return !!process.env.VIDEO_MUTE_URL;
}

/** How long the upload URLs handed to the pipeline stay valid, in seconds. */
export function mutePutTtlSeconds(timeoutMs: number): number {
  return Math.ceil(timeoutMs / 1000) + 60;
}

/**
 * A SILENT copy, from its OWN Modal endpoint (`mute_video`, at
 * `VIDEO_MUTE_URL`), never the upload pipeline's: a deployment without it
 * answers 404, so an old function can never receive the clip or write a copy
 * that keeps its sound.
 *
 * The pipeline reads `source.url` (Scout's signed URL, vetted by the caller)
 * once, writes the copy with every audio stream dropped to `stagedKey` (a
 * STAGING key, never the stored original: the caller verifies the staged
 * bytes and only then copies them into place), and the three posters for
 * `posterKey`. Refuses (throws) unless the answer says `muted: true`; the
 * caller's own read of the bytes is the proof, this flag only the claim.
 *
 * Upload URLs live `mutePutTtlSeconds(timeoutMs)`: a run that outlives our
 * timeout can still write inside that window, which is why the caller
 * schedules a delayed delete of every key handed out here.
 *
 * Redirects are never followed blindly. Modal answers a call that runs past
 * 150 s with 303 to a result URL on its own host; that, and only that, is
 * polled until the deadline. Anything else is an error.
 */
export async function processMutedVideoViaModal(
  source: { url: string },
  keys: { stagedKey: string; posterKey: string },
  attribution?: { userId: string; eventId?: string | null },
  {
    timeoutMs = 240_000,
    fetchImpl = fetch,
  }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<MutedVideoResult> {
  const endpoint = process.env.VIDEO_MUTE_URL;
  if (!endpoint) {
    throw new VideoMuteUnavailableError(
      "VIDEO_MUTE_URL is not configured — deploy modal/video_pipeline.py (mute_video) and set it"
    );
  }
  if (!/^scout-staging\/[^/]+\/[^/]+\.mp4$/i.test(keys.stagedKey)) {
    throw new Error(`a muted copy is staged under scout-staging/ as .mp4, not ${keys.stagedKey}`);
  }

  const putTtl = mutePutTtlSeconds(timeoutMs);
  const [smPut, mdPut, lgPut, stagedPut] = await Promise.all([
    getPresignedUploadUrl(getThumbnailKey(keys.posterKey, "thumb-sm"), "image/jpeg", putTtl),
    getPresignedUploadUrl(getThumbnailKey(keys.posterKey, "thumb-md"), "image/jpeg", putTtl),
    getPresignedUploadUrl(getThumbnailKey(keys.posterKey, "thumb-lg"), "image/jpeg", putTtl),
    getPresignedUploadUrl(keys.stagedKey, "video/mp4", putTtl),
  ]);

  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  const origin = new URL(endpoint).origin;
  const started = Date.now();

  let res = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY ?? null,
      video_url: source.url,
      poster_puts: { sm: smPut, md: mdPut, lg: lgPut },
      staged_put: stagedPut,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(remaining()),
  });
  // A long call: Modal hands back a result URL on its own host to poll.
  while (res.status === 303) {
    const location = res.headers.get("location");
    const next = location ? new URL(location, endpoint) : null;
    if (!next || next.origin !== origin) {
      throw new Error("Video pipeline redirected off its own host; not followed");
    }
    res = await fetchImpl(next.toString(), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(remaining()),
    });
  }
  if (res.status === 404) {
    throw new VideoMuteUnavailableError(
      "The deployed video pipeline has no mute_video endpoint (404) — redeploy modal/video_pipeline.py"
    );
  }
  if (res.status >= 300 && res.status < 400) {
    throw new Error(`Video pipeline answered a redirect (${res.status}); not followed`);
  }
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
    throw new Error("Video pipeline did not confirm a muted copy; nothing is filed");
  }
  return result;
}
