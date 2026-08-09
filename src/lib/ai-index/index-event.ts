/**
 * AI indexing v2 — event-scoped batch indexer (tasks/todo.md "AI revival").
 *
 * Sends batches of thumb-lg presigned URLs to the Modal sps-archive-ai app
 * and persists what comes back. Runs ONLY out-of-band (Inngest job or the
 * backfill script) — never in an upload request path.
 *
 * Write invariant (2026-06-01 post-mortem): this module writes ONLY
 * siglip_embedding, embedding_model, ai_indexed_at, aesthetic_score,
 * sharpness_score on images, plus faces rows. It must never touch
 * processing_status, thumbnail_generated, or anything else the upload or
 * display paths read. If indexing fails, galleries are byte-for-byte
 * unaffected.
 *
 * Faces are replaced per image (same detector as the focal-point pipeline, so
 * boxes are equivalent; focal_x/focal_y live on images and are not touched).
 * NOTE for Phase 2: replacement drops person_id links, so any re-index of an
 * already-clustered image must be followed by a recluster.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Modal endpoint caps at 100 images per call. */
export const AI_INDEX_BATCH = 100;

interface IndexedFace {
  bbox: { x: number; y: number; w: number; h: number };
  embedding: number[] | null;
  quality: number;
  eyesOpen: boolean | null;
}

interface IndexedImage {
  embedding: number[];
  aestheticScore: number;
  sharpnessScore: number;
  faces: IndexedFace[];
}

/** Kill switch + config gate — off means the pipeline does not exist. */
export function isAiIndexingEnabled(): boolean {
  return (
    process.env.AI_INDEXING_ENABLED === "true" &&
    !!process.env.MODAL_AI_INDEX_URL &&
    !!process.env.VIDEO_PIPELINE_KEY
  );
}

/**
 * Uploads still in flight for this event? `pending` rows are presign-created
 * ahead of their binary; indexing must wait until the event has settled.
 */
export async function countPendingUploads(
  supabase: SupabaseDB,
  eventId: string
): Promise<number> {
  const { count } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("processing_status", "pending");
  return count ?? 0;
}

/**
 * Index one batch of unindexed images for an event.
 * Returns how many were indexed, per-image errors, and how many remain.
 */
export async function indexEventBatch(
  supabase: SupabaseDB,
  eventId: string
): Promise<{ indexed: number; faces: number; errors: Record<string, string>; remaining: number }> {
  const { data: batch, error: batchErr } = await supabase
    .from("images")
    .select("id, r2_key")
    .eq("event_id", eventId)
    .is("ai_indexed_at", null)
    .eq("thumbnail_generated", true)
    .eq("media_type", "image")
    .order("id", { ascending: true })
    .limit(AI_INDEX_BATCH);
  if (batchErr) throw batchErr;
  if (!batch?.length) return { indexed: 0, faces: 0, errors: {}, remaining: 0 };

  const payload = {
    pipeline_key: process.env.VIDEO_PIPELINE_KEY,
    images: await Promise.all(
      batch.map(async (img) => ({
        id: img.id,
        url: await getPresignedDownloadUrl(getThumbnailKey(img.r2_key, "thumb-lg"), 1800),
      }))
    ),
  };

  const res = await fetch(process.env.MODAL_AI_INDEX_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    throw new Error(`Modal index_images ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const out = (await res.json()) as {
    model: string;
    results: Record<string, IndexedImage>;
    errors: Record<string, string>;
  };

  const indexedIds = Object.keys(out.results);
  let faceCount = 0;

  // Faces first: replace-per-image, then bulk insert. If the process dies
  // between these writes the image's ai_indexed_at is still NULL, so the next
  // sweep redoes it — the replace makes that idempotent.
  if (indexedIds.length) {
    const { error: delErr } = await supabase.from("faces").delete().in("image_id", indexedIds);
    if (delErr) throw delErr;

    const faceRows = indexedIds.flatMap((imageId) =>
      out.results[imageId].faces.map((f) => ({
        image_id: imageId,
        bbox_x: f.bbox.x,
        bbox_y: f.bbox.y,
        bbox_w: f.bbox.w,
        bbox_h: f.bbox.h,
        embedding: f.embedding ? JSON.stringify(f.embedding) : null,
        quality: f.quality,
        is_eyes_open: f.eyesOpen ?? true,
      }))
    );
    faceCount = faceRows.length;
    if (faceRows.length) {
      const { error: insErr } = await supabase.from("faces").insert(faceRows);
      if (insErr) throw insErr;
    }
  }

  // Image rows last — ai_indexed_at is the "this image is done" marker.
  const indexedAt = new Date().toISOString();
  for (const imageId of indexedIds) {
    const r = out.results[imageId];
    const { error: updErr } = await supabase
      .from("images")
      .update({
        siglip_embedding: JSON.stringify(r.embedding),
        embedding_model: out.model,
        aesthetic_score: r.aestheticScore,
        sharpness_score: r.sharpnessScore,
        ai_indexed_at: indexedAt,
      })
      .eq("id", imageId);
    if (updErr) throw updErr;
  }

  const { count } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("ai_indexed_at", null)
    .eq("thumbnail_generated", true)
    .eq("media_type", "image");

  return {
    indexed: indexedIds.length,
    faces: faceCount,
    errors: out.errors,
    remaining: count ?? 0,
  };
}
