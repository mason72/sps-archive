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

import {
  AI_INDEX_MAX_ATTEMPTS,
  aiIndexEligibleFilter,
  batchFailures,
  redactUrlQueries,
} from "@/lib/ai-index/failures";
import {
  FACE_INSERT_CHUNK,
  FaceInsertOutOfTime,
  insertInShrinkingChunks,
  type DbError,
} from "@/lib/ai-index/face-insert";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { recordUsage, secondsSince } from "@/lib/usage/record";

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

/**
 * How long past `deadline` the per-photo updates may still start. The deadline
 * is 11.5 minutes into a run and the route is killed at 800 s, so this leaves
 * about 20 seconds to throw and report.
 */
const IMAGE_UPDATE_GRACE_MS = 90_000;

export interface IndexBatchOptions {
  /** Face-insert chunk to start at: what the previous batch of this run ended on. */
  faceChunk?: number;
  /**
   * Epoch ms after which no further face INSERT is started (see face-insert.ts);
   * per-photo updates stop IMAGE_UPDATE_GRACE_MS after it.
   */
  deadline?: number;
}

export async function indexEventBatch(
  supabase: SupabaseDB,
  eventId: string,
  options: IndexBatchOptions = {}
): Promise<{
  indexed: number;
  faces: number;
  errors: Record<string, string>;
  remaining: number;
  /** Face-insert chunk this batch ended on; pass it to the next batch. */
  faceChunk?: number;
}> {
  // Eligible only: never failed, or failed but past the cool-down and under the
  // attempt cap (failures.ts). Fewest attempts first, so a retry always goes to
  // the back of the line and a batch of repeat failures can never hide the
  // fresh images behind it.
  const { data: batch, error: batchErr } = await supabase
    .from("images")
    .select("id, r2_key")
    .eq("event_id", eventId)
    .is("ai_indexed_at", null)
    .eq("thumbnail_generated", true)
    .eq("media_type", "image")
    .or(aiIndexEligibleFilter())
    .order("ai_index_attempts", { ascending: true })
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
    // Redacted: this lands in system_errors and the admin email, and Modal's
    // error body can echo a presigned thumbnail URL.
    throw new Error(
      `Modal index_images ${res.status}: ${redactUrlQueries((await res.text()).slice(0, 300))}`
    );
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

  // Record per-image failures BEFORE any other write. The GPU pass is already
  // metered, so if a faces write throws below, the retry must not re-send these
  // ids too — that re-billing loop is what migration 082 exists to stop.
  // Successes keep the old guarantee: ai_indexed_at is still written last.
  const failed = batchFailures(
    batch.map((b) => b.id),
    out
  );
  if (failed.ids.length) {
    const { data: marked, error: failErr } = await supabase.rpc("record_ai_index_failures", {
      p_ids: failed.ids,
      p_errors: failed.messages,
    });
    if (failErr) throw dbFail("record failures", failErr);
    const exhausted = (marked ?? []).filter((m) => m.attempts >= AI_INDEX_MAX_ATTEMPTS);
    if (exhausted.length) {
      // Leaving an image unindexed for good is a decision a human should hear
      // about. Reported, never thrown: the rest of the batch is fine.
      const { reportSystemError } = await import("@/lib/monitoring/report");
      await reportSystemError(
        "ai-index.gave-up",
        new Error(`${exhausted.length} image(s) failed AI indexing ${AI_INDEX_MAX_ATTEMPTS} times`),
        {
          eventId,
          note: "No longer sent to Modal. To retry: set ai_index_attempts = 0 on these rows.",
          images: exhausted.slice(0, 20).map((m) => ({
            id: m.image_id,
            error: failed.messages[failed.ids.indexOf(m.image_id)],
          })),
        }
      );
    }
  }

  const indexedIds = Object.keys(out.results).filter((id) => batch.some((b) => b.id === id));
  let faceCount = 0;
  let faceChunk = options.faceChunk;

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
    // Chunked (FACE_INSERT_CHUNK in face-insert.ts). Partial failure stays safe: ai_indexed_at
    // is written last, so a throw part-way leaves the batch unindexed and the
    // retry's `faces delete` above wipes whatever did land.
    // A timeout halves the chunk and re-sends the same rows (face-insert.ts):
    // a slow database costs time here, not the Modal pass already paid for.
    try {
      const wrote = await insertInShrinkingChunks(
        faceRows,
        async (slice) => {
          const { error: insErr } = await supabase.from("faces").insert(slice);
          return insErr;
        },
        { startChunk: options.faceChunk, deadline: options.deadline }
      );
      faceChunk = wrote.finalChunk;
      if (wrote.shrinks > 0 || wrote.finalChunk < FACE_INSERT_CHUNK) {
        // The batch was saved, so nothing throws, but the database is timing
        // out. Record it where the capacity check counts timeouts
        // (system_errors), WITHOUT an email: absorbing these quietly would hide
        // the exact signal that said the database had outgrown its memory
        // (lesson 175). One row per SLOW BATCH, including batches that only
        // inherited a shrunk chunk, so the count keeps the scale it had when
        // every such batch failed outright and the check's thresholds hold.
        const { error: noteErr } = await supabase.from("system_errors").insert({
          context: "ai-index.slow-insert",
          message:
            `faces insert: statement timeout absorbed ${wrote.shrinks} time(s) this batch, ` +
            `chunk now ${wrote.finalChunk} of ${FACE_INSERT_CHUNK}`,
          detail: { eventId, faceRows: faceRows.length, shrinks: wrote.shrinks },
          notified: false,
          event_id: eventId,
        });
        if (noteErr) console.warn("ai-index slow-insert note not recorded:", noteErr.message);
      }
    } catch (insErr) {
      if (insErr instanceof FaceInsertOutOfTime) throw new Error(`ai-index faces insert: ${insErr.message}`);
      throw dbFail("faces insert", insErr as DbError);
    }
  }

  // Image rows last — ai_indexed_at is the "this image is done" marker.
  const indexedAt = new Date().toISOString();
  let updated = 0;
  for (const imageId of indexedIds) {
    // Same reason as the face-insert deadline: past this the platform kills
    // the run and nothing is reported. Photos already marked stay marked; the
    // rest are picked up by the next batch, which replaces their faces.
    if (
      options.deadline !== undefined &&
      Date.now() > options.deadline + IMAGE_UPDATE_GRACE_MS
    ) {
      throw new Error(
        `ai-index image update: out of time after ${updated} of ${indexedIds.length}; ` +
          `the database is too slow to finish this batch inside the run`
      );
    }
    updated++;
    const r = out.results[imageId];
    const { error: updErr } = await supabase
      .from("images")
      .update({
        siglip_embedding: JSON.stringify(r.embedding),
        embedding_model: out.model,
        aesthetic_score: r.aestheticScore,
        sharpness_score: r.sharpnessScore,
        // A success clears any earlier failure, so a later deliberate re-index
        // (ai_indexed_at nulled) starts with a full set of attempts.
        ai_index_attempts: 0,
        ai_index_failed_at: null,
        ai_index_error: null,
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
    .eq("media_type", "image")
    .or(aiIndexEligibleFilter());

  return {
    indexed: indexedIds.length,
    faces: faceCount,
    errors: out.errors,
    remaining: count ?? 0,
    faceChunk,
  };
}
