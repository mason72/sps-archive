import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import type { FaceBox } from "@/lib/site/focal";

/**
 * Bridge to the on-demand face detection Modal function
 * (modal/face_pipeline.py). Detection-only — it exists so focal-point
 * suggestions work for images the shelved AI pipeline never scanned.
 *
 * Detection runs on the 800px thumbnail (plenty for SCRFD, and it exists for
 * every displayable image — including video posters). Credential-free: we
 * presign the GETs; auth is the shared pipeline key.
 *
 * Env:
 *   FACE_PIPELINE_URL  — deployed endpoint (modal deploy modal/face_pipeline.py)
 *   VIDEO_PIPELINE_KEY — shared pipeline secret (same as the video pipeline)
 */

export function isFaceDetectionConfigured(): boolean {
  return !!process.env.FACE_PIPELINE_URL;
}

export async function detectFacesViaModal(
  items: Array<{ id: string; r2Key: string }>
): Promise<Map<string, FaceBox[]>> {
  const url = process.env.FACE_PIPELINE_URL;
  if (!url || items.length === 0) return new Map();

  const images = await Promise.all(
    items.map(async (item) => ({
      id: item.id,
      url: await getPresignedDownloadUrl(
        getThumbnailKey(item.r2Key, "thumb-lg"),
        1800
      ),
    }))
  );

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY ?? null,
      images,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Face detection failed: ${res.status} ${await res.text().catch(() => "")}`
    );
  }

  const json = (await res.json()) as {
    faces?: Record<
      string,
      Array<{ x: number; y: number; w: number; h: number; quality: number }>
    >;
    errors?: Record<string, string>;
  };

  for (const [id, msg] of Object.entries(json.errors ?? {})) {
    console.warn(`Face detection skipped image ${id}: ${msg}`);
  }

  const result = new Map<string, FaceBox[]>();
  for (const [id, boxes] of Object.entries(json.faces ?? {})) {
    result.set(
      id,
      boxes.map((b) => ({
        bbox_x: b.x,
        bbox_y: b.y,
        bbox_w: b.w,
        bbox_h: b.h,
        quality: b.quality,
      }))
    );
  }
  return result;
}
