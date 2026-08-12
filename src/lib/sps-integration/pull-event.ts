/**
 * Pulling an SPS event into the archive — the byte mover.
 *
 * Replaces the old `importFromSPS`, which minted metadata rows pointing at SPS's
 * own R2 keys on the false premise that the two products share a bucket. They
 * don't: SPS serves from `pub-7363d57d….r2.dev`, the archive stores in
 * `sps-prism`, and every row that path created was a tile this app could not
 * read. **An import moves bytes.**
 *
 * ── Two design choices worth understanding before changing anything here ──
 *
 * **1. The import is driven by the MANIFEST PAGE, not by a list of image ids.**
 * SPS's URLs expire in an hour. Walking page by page means every URL we use is
 * seconds old, `next_offset` on the job row *is* the resume point, and there is
 * no id→URL map to keep fresh. The alternative — collect 6,000 ids up front,
 * then fetch — has to solve URL expiry, resumption and ordering separately.
 *
 * **2. Bytes are written BEFORE the row exists.** The browser upload path
 * cannot do this: it pre-creates a row to hand the client a presigned URL, and
 * that window is where ghost tiles come from (lessons #21–23, the eBay
 * incident, and the reconciler that exists to clean up after it). Server-side we
 * already hold the buffer, so we close the window instead of inheriting it. The
 * failure modes invert, and the new one is strictly cheaper: an object with no
 * row is invisible garbage, which we delete on the failure path anyway.
 *
 * Everything else mirrors the real upload lane deliberately — `buildImageKey`
 * layout, the no-orphan section link, thumbnails, EXIF, and the settlement
 * events that trigger focal points and AI indexing.
 */
import { randomUUID } from "node:crypto";
import type { createServiceClient } from "@/lib/supabase/server";
import { buildImageKey, uploadToR2, deleteFromR2 } from "@/lib/r2/client";
import { generateThumbnailsFromBuffer } from "@/lib/thumbnails/generate";
import { parseFilename, extractExif } from "@/lib/upload/parse-filename";
import {
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  mediaTypeForMime,
} from "@/lib/upload/media";
import { INTAKE_SECTION_NAME } from "@/lib/sections/intake";
import { inngest } from "@/lib/inngest/client";
import { reportSystemError } from "@/lib/monitoring/report";
import { spsEventLinkPatch } from "./event-link";
import { getSpsToken, markSpsPullActivity } from "./connection";
import {
  confirmPulled,
  fetchManifestPage,
  type SpsManifestImage,
} from "./pull-client";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Images imported per Inngest step. Sized so a step lands well inside the
 *  execution route's 800s ceiling even on large files and a slow source. */
export const IMPORT_SLICE = 100;

/** Simultaneous downloads. Each holds a full original in memory. */
const IMPORT_CONCURRENCY = 6;

/**
 * Write progress to the job row every this many photos.
 *
 * Counters used to be written ONCE per slice, at the end. With a 100-image
 * slice that meant the import screen sat at "0 / 105" for over two minutes and
 * then jumped — indistinguishable from a stalled job, which is exactly how
 * Mason read it on the first real import. A slice is a unit of RETRY, not a
 * unit of reporting; progress has to move at human cadence.
 */
const PROGRESS_FLUSH_EVERY = 5;

/** Per-file download ceiling. A stalled source must not eat the whole step. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

/** Failure detail kept on the job row. Enough to retry; not a log file. */
const MAX_RECORDED_FAILURES = 50;

/**
 * Has this page been fully consumed after finishing slice `sliceIndex`?
 *
 * Extracted and exported for one reason: it is the arithmetic that decides
 * whether the walk moves to the next manifest page, and getting it wrong is
 * SILENT — an off-by-one here means the tail of every page is never imported and
 * nothing anywhere reports a problem. A guard for that has to be testable
 * independently of the importer it guards.
 *
 * `pageSize` is the count AFTER the exclusion set, so a page where everything
 * was deselected is drained by its first (empty) slice.
 */
export function isPageDrained(sliceIndex: number, pageSize: number): boolean {
  return (sliceIndex + 1) * IMPORT_SLICE >= pageSize;
}

export interface SpsPullJob {
  id: string;
  user_id: string;
  event_id: string;
  sps_event_id: string;
  status: string;
  next_offset: number;
  expected_total: number | null;
  images_done: number;
  images_failed: number;
  images_skipped: number;
  bytes_copied: number;
  confirmed: number;
  deselected: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Kickoff
// ─────────────────────────────────────────────────────────────────────────────

export type StartPullResult =
  | { ok: true; eventId: string; jobId: string; resumed: boolean }
  | { ok: false; reason: "not-connected" | "already-imported" | "in-progress" | "empty"; message: string; eventId?: string; jobId?: string };

/**
 * Create the archive event and queue the pull.
 *
 * `deselected` is the EXCLUSION set from the review screen — everything is
 * selected by default, so this is normally empty or tiny, and the import never
 * depends on how far the photographer scrolled the grid.
 *
 * `expectedTotal` is a DISPLAY hint from the client (it has already walked the
 * manifest to render the grid). Completion is decided by the absence of
 * `nextOffset`, never by this number: `event.imageCount` counts AI copies the
 * manifest excludes, and any client-supplied count is a view, not the truth.
 */
export async function startSpsPull(
  supabase: SupabaseDB,
  userId: string,
  input: {
    spsEventId: string;
    deselected?: string[];
    expectedTotal?: number | null;
  }
): Promise<StartPullResult> {
  const token = await getSpsToken(supabase, userId);
  if (!token) {
    return {
      ok: false,
      reason: "not-connected",
      message: "Connect SimplePhotoShare first (Account → Connections).",
    };
  }

  // An unfinished job for this SPS event is a resume, not a second import.
  // Without this, a double-click on Import creates two events racing into the
  // same photos — the unique index would stop the duplicate rows, but only
  // after both jobs had moved the bytes.
  const { data: existingJobs, error: jobErr } = await supabase
    .from("sps_pull_jobs")
    .select("id, event_id, status")
    .eq("user_id", userId)
    .eq("sps_event_id", input.spsEventId)
    .order("created_at", { ascending: false });
  if (jobErr) throw jobErr;

  const live = (existingJobs ?? []).find(
    (j) => j.status === "queued" || j.status === "running"
  );
  if (live) {
    return {
      ok: false,
      reason: "in-progress",
      message: "This event is already importing.",
      eventId: live.event_id,
      jobId: live.id,
    };
  }

  const done = (existingJobs ?? []).find((j) => j.status === "completed");
  if (done) {
    return {
      ok: false,
      reason: "already-imported",
      message: "This event has already been imported.",
      eventId: done.event_id,
      jobId: done.id,
    };
  }

  // A cancelled or failed job RESUMES into the event it already created. It must
  // not start a second one: the archive event exists, its photos are real, and
  // `next_offset` plus the per-image skip check make continuing exact. (This is
  // also what the import screen promises when it says stopping keeps what
  // landed.) The deselection set is whatever review chose the first time —
  // re-deciding it here would silently override the photographer.
  const resumable = (existingJobs ?? []).find(
    (j) => j.status === "cancelled" || j.status === "failed"
  );
  if (resumable) {
    const { error: resumeErr } = await supabase
      .from("sps_pull_jobs")
      .update({
        status: "queued",
        error: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", resumable.id);
    if (resumeErr) throw resumeErr;

    await inngest.send({
      name: "sps/pull.requested",
      data: { jobId: resumable.id },
    });

    return {
      ok: true,
      eventId: resumable.event_id,
      jobId: resumable.id,
      resumed: true,
    };
  }

  // First page doubles as the access check and the source of the event's name
  // and date — never trust the client for either.
  const firstPage = await fetchManifestPage(token, input.spsEventId, 0);
  if (!firstPage.images.length) {
    return {
      ok: false,
      reason: "empty",
      message: "SPS reports no importable photos for that event.",
    };
  }

  const spsEvent = firstPage.event;
  const slug =
    `${spsEvent.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`;

  const { data: event, error: eventError } = await supabase
    .from("events")
    .insert({
      user_id: userId,
      name: spsEvent.name,
      slug,
      // SPS's `date` is the event's start_time; the archive column is a DATE.
      event_date: spsEvent.date ? spsEvent.date.slice(0, 10) : null,
      // One key, one home — see event-link.ts. A pulled event arrives already
      // linked, which is the whole reason name matching never has to happen.
      settings: spsEventLinkPatch({
        eventId: spsEvent.id,
        eventName: spsEvent.name,
        linkedAt: new Date().toISOString(),
        source: "sps-import",
      }),
    })
    .select("id")
    .single();
  if (eventError) throw eventError;

  // Photos land in the intake section, never Highlights — an SPS gallery is the
  // live feed, and Highlights is the curated best-of the photographer builds
  // from it. (Same invariant the upload route enforces: no orphan images.)
  const { error: sectionError } = await supabase.from("sections").insert({
    event_id: event.id,
    name: INTAKE_SECTION_NAME,
    sort_order: 0,
    is_auto: false,
  });
  if (sectionError) {
    // Nothing has moved yet — take the empty event with it rather than leaving
    // a sectionless husk in the archive list.
    await supabase.from("events").delete().eq("id", event.id);
    throw sectionError;
  }

  const { data: job, error: jobInsertError } = await supabase
    .from("sps_pull_jobs")
    .insert({
      user_id: userId,
      event_id: event.id,
      sps_event_id: input.spsEventId,
      sps_event_name: spsEvent.name,
      status: "queued",
      deselected: input.deselected ?? [],
      expected_total: input.expectedTotal ?? null,
    })
    .select("id")
    .single();
  if (jobInsertError) {
    await supabase.from("events").delete().eq("id", event.id);
    throw jobInsertError;
  }

  await inngest.send({
    name: "sps/pull.requested",
    data: { jobId: job.id },
  });

  return { ok: true, eventId: event.id, jobId: job.id, resumed: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// The worker
// ─────────────────────────────────────────────────────────────────────────────

export interface SliceResult {
  imported: number;
  failed: number;
  skipped: number;
  bytes: number;
  confirmed: number;
  /** Images in this page after the exclusion set — used to plan the next slice. */
  pageSize: number;
  /** Absent when this was the last manifest page. */
  nextOffset: number | null;
  /**
   * Set by importSlice once it has folded its own counters into the job row
   * (it flushes progress as it goes, so the caller must not add them again).
   * The caller still owns `next_offset`, which only advances on a drained page.
   */
  alreadyFolded?: boolean;
}

/** Pages walked while counting before giving up and running without a total. */
const COUNT_PAGE_CAP = 60;

/**
 * Count what this import will actually move, and store it as the denominator.
 *
 * Runs inside the job rather than at kickoff, so pressing Import stays instant on
 * a 9,000-photo event — the number appears a minute later, and the UI already
 * handles not having it yet.
 *
 * This exists because the client cannot be the source of the total. It only knows
 * how many images it has PAGED IN, and the review grid pages as you scroll — so on
 * a big event the denominator depended on whether the photographer happened to
 * scroll to the end. A 3.5-hour import showing a bar with no total is the
 * "looks stalled" failure all over again.
 *
 * Counts the manifest, not `event.imageCount`: that includes the AI copies the
 * manifest excludes. Subtracts the exclusion set, so it matches what will land.
 */
export async function countExpectedTotal(
  supabase: SupabaseDB,
  job: SpsPullJob
): Promise<number | null> {
  const token = await getSpsToken(supabase, job.user_id);
  if (!token) return null;

  const excluded = new Set(job.deselected ?? []);
  let total = 0;
  let offset = 0;

  for (let page = 0; page < COUNT_PAGE_CAP; page++) {
    const p = await fetchManifestPage(token, job.sps_event_id, offset);
    total += p.images.filter((i) => !excluded.has(i.id)).length;
    if (p.nextOffset === undefined) {
      const { error } = await supabase
        .from("sps_pull_jobs")
        .update({ expected_total: total, updated_at: new Date().toISOString() })
        .eq("id", job.id);
      if (error) throw error;
      return total;
    }
    offset = p.nextOffset;
  }

  // Bigger than anything real. Better to run with no denominator than to store a
  // number that is quietly a floor rather than a total.
  console.warn(
    `SPS pull ${job.id}: manifest exceeded ${COUNT_PAGE_CAP} pages while counting; running without a total.`
  );
  return null;
}

export async function loadPullJob(
  supabase: SupabaseDB,
  jobId: string
): Promise<SpsPullJob | null> {
  const { data, error } = await supabase
    .from("sps_pull_jobs")
    .select(
      "id, user_id, event_id, sps_event_id, status, next_offset, expected_total, images_done, images_failed, images_skipped, bytes_copied, confirmed, deselected"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return (data as SpsPullJob | null) ?? null;
}

/**
 * Import one slice of one manifest page.
 *
 * Re-fetches the page every call, on purpose: it costs one request and it means
 * the signed URLs in hand are always seconds old, so a slow step, a retry, or a
 * resumed job can never present an expired URL. Images already in the event are
 * skipped, which is what makes a retried slice safe.
 */
export async function importSlice(
  supabase: SupabaseDB,
  job: SpsPullJob,
  offset: number,
  sliceIndex: number
): Promise<SliceResult> {
  const token = await getSpsToken(supabase, job.user_id);
  if (!token) throw new Error("SPS connection is gone — nothing to pull with.");

  const page = await fetchManifestPage(token, job.sps_event_id, offset);
  const excluded = new Set(job.deselected ?? []);
  const wanted = page.images.filter((img) => !excluded.has(img.id));
  const slice = wanted.slice(
    sliceIndex * IMPORT_SLICE,
    (sliceIndex + 1) * IMPORT_SLICE
  );

  const result: SliceResult = {
    imported: 0,
    failed: 0,
    skipped: 0,
    bytes: 0,
    confirmed: 0,
    pageSize: wanted.length,
    nextOffset: page.nextOffset ?? null,
  };

  if (!slice.length) return result;

  // Already here? A resumed or retried slice must not re-move bytes. The unique
  // index (event_id, sps_image_id) is the hard guarantee; this is the cheap
  // check that avoids paying for the download first.
  const { data: present, error: presentErr } = await supabase
    .from("images")
    .select("sps_image_id, sps_pulled_at")
    .eq("event_id", job.event_id)
    .in(
      "sps_image_id",
      slice.map((s) => s.id)
    );
  if (presentErr) throw presentErr;
  const alreadyHere = new Set(
    (present ?? []).map((r) => r.sps_image_id).filter(Boolean) as string[]
  );

  const todo = slice.filter((img) => !alreadyHere.has(img.id));
  result.skipped = slice.length - todo.length;

  // Rows that landed on an earlier attempt of THIS slice but never got their
  // confirmation call — a step that failed after some images were written, then
  // retried. Without this they would sit unconfirmed forever, and SPS would
  // hold copies it is entitled to release. They are already durable, which is
  // the only precondition /pulled has.
  const owedConfirmation = (present ?? [])
    .filter((r) => r.sps_image_id && !r.sps_pulled_at)
    .map((r) => r.sps_image_id as string);

  if (!todo.length && !owedConfirmation.length) return result;

  const durable: string[] = [...owedConfirmation];

  if (!todo.length) {
    await confirmDurable(supabase, token, job, durable, result);
    if (result.skipped || result.confirmed) {
      try {
        await applySliceResult(supabase, job.id, result, null);
      } catch (err) {
        console.error("SPS pull skip-count flush failed:", err);
      }
    }
    result.alreadyFolded = true;
    return result;
  }

  // Append after whatever the section already holds — the intake reads in
  // arrival order, and a pulled event may be resumed across several runs.
  const { data: section, error: sectionErr } = await supabase
    .from("sections")
    .select("id")
    .eq("event_id", job.event_id)
    .ilike("name", INTAKE_SECTION_NAME)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (sectionErr) throw sectionErr;
  if (!section) throw new Error("Intake section missing for this event");

  const { data: tail, error: tailErr } = await supabase
    .from("section_images")
    .select("sort_order")
    .eq("section_id", section.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (tailErr) throw tailErr;
  const sortBase = (tail?.[0]?.sort_order ?? -1) + 1;

  const failures: { spsImageId: string; filename: string; reason: string }[] = [];

  // Counters already folded into the job row, so each flush writes only the
  // DELTA since the last one. applySliceResult adds to what it reads, so
  // flushing totals would multiply them.
  const flushed = { imported: 0, failed: 0, skipped: 0, bytes: 0 };
  let sinceFlush = 0;
  const flushProgress = async () => {
    const delta: SliceResult = {
      imported: result.imported - flushed.imported,
      failed: result.failed - flushed.failed,
      skipped: result.skipped - flushed.skipped,
      bytes: result.bytes - flushed.bytes,
      confirmed: 0, // confirmation is its own step, after the whole slice
      pageSize: result.pageSize,
      nextOffset: result.nextOffset,
    };
    if (!delta.imported && !delta.failed && !delta.skipped) return;
    flushed.imported = result.imported;
    flushed.failed = result.failed;
    flushed.skipped = result.skipped;
    flushed.bytes = result.bytes;
    sinceFlush = 0;
    // Never fatal: this is a progress readout, and losing one tick must not
    // cost the photos in flight.
    try {
      await applySliceResult(supabase, job.id, delta, null);
    } catch (err) {
      console.error("SPS pull progress flush failed:", err);
    }
  };

  // Bounded parallelism: each worker holds one full original in memory.
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(IMPORT_CONCURRENCY, todo.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= todo.length) return;
        const img = todo[index];
        try {
          const outcome = await importOneImage(supabase, job, {
            image: img,
            sectionId: section.id,
            sortOrder: sortBase + index,
          });
          if (outcome.status === "imported") {
            result.imported++;
            result.bytes += outcome.bytes;
            durable.push(img.id);
          } else {
            result.skipped++;
          }
        } catch (err) {
          result.failed++;
          failures.push({
            spsImageId: img.id,
            filename: img.originalFilename,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
        if (++sinceFlush >= PROGRESS_FLUSH_EVERY) await flushProgress();
      }
    })
  );

  // The remainder, so the row is accurate the moment the slice ends rather than
  // when the lane gets around to writing it.
  await flushProgress();
  result.alreadyFolded = true;

  await confirmDurable(supabase, token, job, durable, result);

  // The confirmation count lands after the last progress flush, so fold it
  // separately rather than leaving it for a caller that has been told the
  // counters are already done.
  if (result.confirmed) {
    try {
      await applySliceResult(
        supabase,
        job.id,
        { ...result, imported: 0, failed: 0, skipped: 0, bytes: 0 },
        null
      );
    } catch (err) {
      console.error("SPS pull confirm-count flush failed:", err);
    }
  }

  if (failures.length) {
    await recordFailures(supabase, job.id, failures);
  }

  return result;
}

/**
 * ⚠️ ORDERING — the call that can lose data.
 *
 * Only ids whose bytes are in R2 and whose rows are complete reach this
 * function, because this call is what makes SPS's copy eligible for deletion.
 * Confirming per slice rather than at the end means a crash keeps the
 * confirmations already earned.
 *
 * A failure here is deliberately NOT fatal and NOT retried inline: SPS holds an
 * unclaimed copy for 30 days, so an unconfirmed image loses nothing. The rows
 * keep a null `sps_pulled_at`, which is the queryable record of what still owes
 * SPS a call.
 */
async function confirmDurable(
  supabase: SupabaseDB,
  token: string,
  job: SpsPullJob,
  durable: string[],
  result: SliceResult
): Promise<void> {
  if (!durable.length) return;
  try {
    result.confirmed = await confirmPulled(token, job.sps_event_id, durable);
    const { error: stampErr } = await supabase
      .from("images")
      .update({ sps_pulled_at: new Date().toISOString() })
      .eq("event_id", job.event_id)
      .in("sps_image_id", durable);
    if (stampErr) throw stampErr;
  } catch (err) {
    console.error("SPS /pulled confirmation failed:", err);
    await reportSystemError("sps.pull-confirm", err, {
      jobId: job.id,
      eventId: job.event_id,
      count: durable.length,
    });
  }
}

/**
 * One photo: fetch → R2 → row → section link → thumbnails/EXIF → complete.
 *
 * Ordering is the whole point. Bytes land before the row exists, so there is no
 * moment at which a row references an object that isn't there. Every failure
 * path after the upload deletes what it created.
 */
async function importOneImage(
  supabase: SupabaseDB,
  job: SpsPullJob,
  ctx: { image: SpsManifestImage; sectionId: string; sortOrder: number }
): Promise<{ status: "imported"; bytes: number } | { status: "skipped" }> {
  const { image, sectionId, sortOrder } = ctx;

  // ── 1. Fetch from SPS ──
  const res = await fetch(image.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`source fetch ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";
  // A presigned URL that has expired, or a bucket that answers with an XML
  // error, is a 200 with the wrong type — trusting the status alone would store
  // an error document as a photograph.
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    throw new Error(`source type ${contentType || "unknown"}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength < 1024) throw new Error("source too small");

  const mimeType = image.mimeType || contentType;
  const mediaType = mediaTypeForMime(mimeType);
  const cap = mediaType === "video" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES;
  if (buffer.byteLength > cap) {
    throw new Error(
      `source too large (${(buffer.byteLength / 1e6).toFixed(1)} MB)`
    );
  }

  // ── 2. Bytes first ──
  const id = randomUUID();
  const parsed = parseFilename(image.originalFilename);
  const filename = `${id}.${parsed.extension}`;
  const r2Key = buildImageKey(job.event_id, filename);
  await uploadToR2(r2Key, buffer, mimeType);

  // From here on, every exit path must clean up the object it just wrote.
  const abandon = async () => {
    try {
      await deleteFromR2(r2Key);
    } catch (err) {
      console.error(`SPS pull: orphaned R2 object ${r2Key}`, err);
    }
  };

  // ── 3. The row ──
  const { error: insertErr } = await supabase.from("images").insert({
    id,
    event_id: job.event_id,
    filename,
    original_filename: image.originalFilename,
    r2_key: r2Key,
    // OUR byte count. SPS deliberately reports no size — its images.file_size
    // sums six variants and is ~3x the object behind this URL.
    file_size: buffer.byteLength,
    mime_type: mimeType,
    media_type: mediaType,
    parsed_name: parsed.name,
    processing_status: "pending",
    sps_image_id: image.id,
    // Reported by SPS, never inferred. See pull-client.ts.
    sps_quality: image.quality,
  });

  if (insertErr) {
    await abandon();
    // 23505 = unique violation on (event_id, sps_image_id): a concurrent slice
    // won the race. Correct outcome, not a failure.
    if ((insertErr as { code?: string }).code === "23505") {
      return { status: "skipped" };
    }
    throw insertErr;
  }

  // ── 4. Section link — no orphans, ever ──
  const { error: linkErr } = await supabase.from("section_images").insert({
    section_id: sectionId,
    image_id: id,
    sort_order: sortOrder,
  });
  if (linkErr) {
    await supabase.from("images").delete().eq("id", id);
    await abandon();
    throw linkErr;
  }

  // ── 5. Display work, then complete ──
  // Videos: the binary is safe in R2, which is what "complete" means here, but
  // posters and duration come from the Modal ffmpeg pipeline. Same handoff
  // /api/upload/complete performs.
  if (mediaType === "video") {
    const { error: updErr } = await supabase
      .from("images")
      .update({ processing_status: "complete" })
      .eq("id", id);
    if (updErr) throw updErr;

    inngest
      .send({
        name: "video/uploaded",
        data: { imageId: id, eventId: job.event_id, r2Key },
      })
      .catch((err) => console.error("video pipeline dispatch failed:", err));

    return { status: "imported", bytes: buffer.byteLength };
  }

  const update: Record<string, unknown> = { processing_status: "complete" };
  update.width = image.width ?? null;
  update.height = image.height ?? null;

  // Thumbnails from the buffer we already hold — the upload path's /complete
  // re-downloads the original from R2 to do this; we don't have to.
  //
  // BEST-EFFORT, and it matters. Letting this throw would abandon the row at
  // processing_status = "pending" with its bytes already safe in R2 — which is
  // not a ghost tile but is worse in one specific way: a stale pending row
  // blocks the event's ENTIRE AI pipeline (countPendingUploads gates it for 30
  // minutes) and reads to the photographer as "still uploading". One
  // unthumbnailable frame would stall indexing for the whole event. The upload
  // path treats thumbnails as best-effort for the same reason; the grid
  // self-heals on view and the reconciler backfills the rest.
  try {
    const thumbs = await generateThumbnailsFromBuffer(
      buffer,
      job.event_id,
      filename
    );
    update.thumbnail_generated = true;
    update.thumb_bytes = thumbs.thumbBytes;
    if (thumbs.width) update.width = thumbs.width;
    if (thumbs.height) update.height = thumbs.height;
    if (thumbs.dominantColor) update.dominant_color = thumbs.dominantColor;
  } catch (thumbErr) {
    console.error(`SPS pull: thumbnail failed for ${filename}:`, thumbErr);
    await reportSystemError("sps.pull-thumbnail", thumbErr, {
      imageId: id,
      eventId: job.event_id,
      spsImageId: image.id,
    });
  }

  const exif = await extractExif(arrayBuffer);
  if (exif) {
    if (exif.takenAt) update.taken_at = exif.takenAt;
    if (exif.cameraMake) update.camera_make = exif.cameraMake;
    if (exif.cameraModel) update.camera_model = exif.cameraModel;
    if (exif.lens) update.lens = exif.lens;
    if (exif.focalLength) update.focal_length = exif.focalLength;
    if (exif.aperture) update.aperture = exif.aperture;
    if (exif.shutterSpeed) update.shutter_speed = exif.shutterSpeed;
    if (exif.iso) update.iso = exif.iso;
    if (exif.gpsLat) update.gps_lat = exif.gpsLat;
    if (exif.gpsLng) update.gps_lng = exif.gpsLng;
  }
  // SPS's `capturedAt` is its row's created_at — upload time, not shutter time.
  // Only worth having when the file carries no EXIF date of its own.
  if (!update.taken_at && image.capturedAt) update.taken_at = image.capturedAt;

  const { error: updateErr } = await supabase
    .from("images")
    .update(update)
    .eq("id", id);
  if (updateErr) throw updateErr;

  return { status: "imported", bytes: buffer.byteLength };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job bookkeeping
// ─────────────────────────────────────────────────────────────────────────────

export async function markJobRunning(
  supabase: SupabaseDB,
  jobId: string
): Promise<void> {
  const { error } = await supabase
    .from("sps_pull_jobs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw error;
}

/**
 * Fold a slice's counters into the job row.
 *
 * Re-reads the row rather than adding to a caller's snapshot: the Inngest run
 * loads the job once and then runs many slices, so folding into that first
 * snapshot would write `first + latest` every time and lose everything in
 * between. (The read-modify-write is safe because a job runs with Inngest
 * concurrency keyed to its own id — one worker per job, by construction.)
 */
export async function applySliceResult(
  supabase: SupabaseDB,
  jobId: string,
  slice: SliceResult,
  nextOffset: number | null
): Promise<void> {
  const current = await loadPullJob(supabase, jobId);
  if (!current) throw new Error(`Pull job ${jobId} vanished mid-import`);

  const { error } = await supabase
    .from("sps_pull_jobs")
    .update({
      images_done: current.images_done + slice.imported,
      images_failed: current.images_failed + slice.failed,
      images_skipped: current.images_skipped + slice.skipped,
      bytes_copied: current.bytes_copied + slice.bytes,
      confirmed: current.confirmed + slice.confirmed,
      // Only advances when a page is fully drained, so a resumed run re-walks
      // at most one page and skips what it already has.
      ...(nextOffset !== null ? { next_offset: nextOffset } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function finishJob(
  supabase: SupabaseDB,
  jobId: string,
  outcome: { status: "completed" | "failed" | "cancelled"; error?: string }
): Promise<void> {
  const { error } = await supabase
    .from("sps_pull_jobs")
    .update({
      status: outcome.status,
      error: outcome.error ?? null,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
  if (error) throw error;
}

async function recordFailures(
  supabase: SupabaseDB,
  jobId: string,
  failures: { spsImageId: string; filename: string; reason: string }[]
): Promise<void> {
  const { data, error } = await supabase
    .from("sps_pull_jobs")
    .select("failures")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;

  const existing = Array.isArray(data?.failures)
    ? (data!.failures as { spsImageId: string; filename: string; reason: string }[])
    : [];
  const merged = [...existing, ...failures].slice(0, MAX_RECORDED_FAILURES);

  const { error: updErr } = await supabase
    .from("sps_pull_jobs")
    .update({ failures: merged, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (updErr) throw updErr;
}

/**
 * Settlement, once the whole event has landed.
 *
 * Fired at the END of the import rather than per photo: both lanes debounce per
 * event anyway, and 6,000 sends to say the same thing is a way to get rate
 * limited. Fire-and-forget — a nicety that fails must never look like an import
 * that failed.
 */
export async function dispatchPullSettlement(
  supabase: SupabaseDB,
  job: SpsPullJob
): Promise<void> {
  await markSpsPullActivity(supabase, job.user_id);
  try {
    await inngest.send({
      name: "focal/auto.suggest",
      data: { eventId: job.event_id },
    });
    await inngest.send({
      name: "ai/index.requested",
      data: { eventId: job.event_id },
    });
  } catch (err) {
    console.error("SPS pull settlement dispatch failed:", err);
  }
}
