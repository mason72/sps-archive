import {
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  getThumbnailKey,
  getVideoDisplayKey,
} from "@/lib/r2/client";

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

export async function processVideoViaModal(r2Key: string): Promise<VideoProcessResult> {
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
      `Video pipeline failed: ${res.status} ${await res.text().catch(() => "")}`
    );
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
