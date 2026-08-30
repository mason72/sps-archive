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
import { recordUsage, secondsSince } from "@/lib/usage/record";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Modal endpoint caps at 100 images per call. */
export const AI_INDEX_BATCH = 100;

/**
 * Rows per `faces` INSERT statement.
 *
 * `faces` carries an HNSW index on the binary-quantized embedding, so every
 * inserted row has to be woven into that graph — a cost per row that climbs as
 * the graph grows (173,647 faces / 59 MB at the time of writing). A whole batch
 * in one statement is ~1,000 rows on a group-shot gallery (measured: 9.7 faces
 * per image at the top of the archive, 129 faces on a single frame), and
 * PostgREST's 8s statement_timeout cancelled exactly that four times — 57014 on
 * 2026-08-12 (x2), 08-29 and 08-30, each one throwing away a Modal pass that had
 * already been metered.
 *
 * Sized against a MEASURED excursion, not against the warm case. Timed on the
 * live index (rolled-back transactions), the warm cost is flatly linear at
 * ~2.1ms/row — 50 rows 107ms, 75 rows 151ms, 100 rows 223ms, 150 rows 360ms.
 * But the session's FIRST write ran 8,606ms for 150 rows, a ~20x excursion, and
 * that is the condition production actually fails in: every one of the four
 * timeouts hit the first batch of the nightly sweep, minutes after the 09:43
 * reconciler cron, on an index nobody had written to for hours.
 *
 * So the warm number is the wrong thing to size on. At 50 rows the same 20x
 * excursion lands at ~2.1s against the 8s ceiling; at 150 it lands at ~7.2s,
 * which passes and tells you nothing about the next one. The excursion factor
 * comes from a single observation and cannot be characterised from that, which
 * is the argument FOR headroom rather than against it.
 *
 * Cost of the smaller chunk is ~20 statements instead of 7 on a 1,000-row batch,
 * about 2s of extra round-trips inside a job that runs for minutes. Note this is
 * cheaper than shrinking AI_INDEX_BATCH, which would buy the same safety by
 * paying Modal for more GPU round-trips.
 */
const FACE_INSERT_CHUNK = 50;

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
 * A pending row stops looking like an upload in flight after this long. Matches
 * the reconciler's own staleness cutoff (RECONCILE_STALE_MINUTES) — the two
 * describe the same thing and must not drift.
 */
export const PENDING_UPLOAD_STALE_MINUTES = 30;

/**
 * Uploads still in flight for this event? `pending` rows are presign-created
 * ahead of their binary; indexing must wait until the event has settled.
 *
 * RECENT pending rows only. A row that has sat pending for hours is not an
 * upload in flight, it's a ghost — its bytes never arrived — and counting it
 * starves the whole event forever, because `ai-index` returns
 * `skipped: "uploads-in-flight"` and therefore never sends
 * `faces/cluster.requested` either. Hotel Data Conference 2026 (2026-08-10)
 * lost semantic search, faces, smart sections AND selfie search across 5,778
 * finished photos to exactly NINE stuck rows.
 */
export async function countPendingUploads(
  supabase: SupabaseDB,
  eventId: string
): Promise<number> {
  const cutoff = new Date(
    Date.now() - PENDING_UPLOAD_STALE_MINUTES * 60 * 1000
  ).toISOString();
  const { count } = await supabase
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("processing_status", "pending")
    .gt("created_at", cutoff);
  return count ?? 0;
}

/**
 * Index one batch of unindexed images for an event.
 * Returns how many were indexed, per-image errors, and how many remain.
 */
/**
 * Raise a Supabase error as a real Error, naming the write that failed.
 *
 * `if (err) throw err` raises PostgREST's plain object, and anything that
 * stringifies it gets "[object Object]" — which is exactly what two ai-index
 * alerts said on 2026-08-11, with no way to tell a batch-select failure from a
 * face-insert failure. The `where` label is the part that turns an alert into a
 * diagnosis.
 */
function dbFail(
  where: string,
  err: { message?: string; code?: string; details?: string; hint?: string }
): Error {
  const parts = [
    err.code ? `code ${err.code}` : null,
    err.details || null,
    err.hint || null,
  ].filter(Boolean);
  return new Error(
    `ai-index ${where}: ${err.message ?? "unknown"}${parts.length ? ` (${parts.join("; ")})` : ""}`
  );
}

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
  if (batchErr) throw dbFail("batch select", batchErr);
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

  // Owner looked up BEFORE the clock starts so the metered seconds are pure
  // Modal wall-time, not Modal + a DB roundtrip.
  const { data: owner } = await supabase
    .from("events")
    .select("user_id")
    .eq("id", eventId)
    .single();

  const started = Date.now();
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

  // Meter the GPU round-trip against the event owner. events.user_id is
  // nullable — ownerless events just go unmetered. Awaited: a void insert
  // races the Inngest step boundary and drops the final batch's row.
  if (owner?.user_id) {
    await recordUsage({
      userId: owner.user_id,
      eventId,
      kind: "ai_index",
      quantity: secondsSince(started),
      unit: "seconds",
      metadata: {
        images: batch.length,
        indexed: Object.keys(out.results).length,
        errors: Object.keys(out.errors).length,
      },
    });
  }

  const indexedIds = Object.keys(out.results);
  let faceCount = 0;

  // Faces first: replace-per-image, then bulk insert. If the process dies
  // between these writes the image's ai_indexed_at is still NULL, so the next
  // sweep redoes it — the replace makes that idempotent.
  if (indexedIds.length) {
    const { error: delErr } = await supabase.from("faces").delete().in("image_id", indexedIds);
    if (delErr) throw dbFail("faces delete", delErr);

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
    // Chunked per FACE_INSERT_CHUNK. Partial failure stays safe: ai_indexed_at
    // is written last, so a throw part-way leaves the batch unindexed and the
    // retry's `faces delete` above wipes whatever did land.
    for (let i = 0; i < faceRows.length; i += FACE_INSERT_CHUNK) {
      const { error: insErr } = await supabase
        .from("faces")
        .insert(faceRows.slice(i, i + FACE_INSERT_CHUNK));
      if (insErr) throw dbFail("faces insert", insErr);
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
    if (updErr) throw dbFail("image update", updErr);
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
