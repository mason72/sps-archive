/**
 * The closing sweep — what a pull left behind, and going back for it.
 *
 * The walk in `pull-event.ts` catches a failed photo, counts it and moves on,
 * which is right for a 7,000-photo import and wrong as a last word: until
 * 2026-10-04 the job was then marked `completed`, `startSpsPull` answered
 * "already imported" for it forever, and the photo could never be fetched.
 * AAOMS 2026 finished 7,104 of 7,109 that way, during a run of database
 * timeouts.
 *
 * So every pull ends with a sweep: each photo the walk failed on gets ONE more
 * try, and what is still absent is stored on the job (`sps_pull_jobs.missing`).
 * The import screen prints that list and offers to retry it.
 *
 * ── Two questions, two records. Neither is trusted for the other's job. ──
 *
 * **Which photos is this import responsible for? The failure log NOMINATES.**
 * A gallery is curated, sometimes while it is still importing. eBay RCG MiniCon
 * sits 95 photos under its manifest because they were moved into private
 * galleries; DAIS 26 is 12 under after a consolidation. "On SPS, not in the
 * gallery" is therefore not "failed to import", and a sweep that compared the
 * whole manifest would bring back everything a person removed. Only photos the
 * job recorded a failure for (or, on a retry, the list it stored) are ever
 * fetched.
 *
 * **Is a nominated photo actually missing? The ROWS decide.** The log named
 * nine AAOMS photos and four of them were in the gallery: they failed AFTER
 * their row was written, and the upload reconciler finished them. A log
 * records attempts. So every nominee is checked against the manifest and the
 * event's rows, before the attempt and again after a failed one.
 *
 * **And SPS is told only what is proved.** `POST /pulled` lets SPS delete its
 * copy. A photo this step imported is durable by construction (bytes before
 * row). A nominee found already here was finished by something else, so its
 * object is HEAD-checked first.
 *
 * The lane's own invariants hold unchanged: this calls the same
 * `importOneImage`, counters fold through `sps_pull_add_progress`, and the
 * unique index on (event_id, sps_image_id) is what makes a re-run harmless.
 *
 * (The worker loop below repeats the one in `importSlice`. It was left as a
 * copy on purpose on 2026-10-04: another session had an uncommitted edit in
 * the middle of that loop. Fold the two into one `importBatch` when both are
 * on main.)
 */
import { inngest } from "@/lib/inngest/client";
import { describeError } from "@/lib/monitoring/report";
import { objectExistsInR2 } from "@/lib/r2/client";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import { getSpsToken } from "./connection";
import { fetchManifestPage, type SpsManifestImage } from "./pull-client";
import {
  IMPORT_CONCURRENCY,
  IMPORT_SLICE,
  PROGRESS_FLUSH_EVERY,
  applySliceResult,
  confirmDurable,
  createProgressFlusher,
  importOneImage,
  intakeAppendPoint,
  type ProgressCounters,
  type SliceResult,
  type SpsPullJob,
} from "./pull-event";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Ids per `.in()` filter. PostgREST puts the list in the query string, so an
 *  unbounded one answers a bare 400, and a manifest page is 500 ids. */
const ID_CHUNK = 100;

/** Simultaneous R2 HEADs while proving a row's object is there. */
const HEAD_CONCURRENCY = 8;

export const GONE_REASON = "No longer on SimplePhotoShare";

/** One photo a finished pull does not have. */
export interface MissingPhoto {
  spsImageId: string;
  filename: string;
  /** Why the last attempt failed, in words a person can act on. */
  reason: string;
  /** SPS no longer lists it, so there is nothing left to fetch. */
  gone?: boolean;
}

/**
 * Parse `sps_pull_jobs.missing`. Null means the job was never swept (every job
 * finished before migration 093), which is a different answer from "nothing
 * missing" and must stay different all the way to the screen.
 */
export function readMissing(value: unknown): MissingPhoto[] | null {
  if (!Array.isArray(value)) return null;
  const out: MissingPhoto[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.spsImageId !== "string" || !e.spsImageId) continue;
    out.push({
      spsImageId: e.spsImageId,
      filename: typeof e.filename === "string" ? e.filename : e.spsImageId,
      reason: typeof e.reason === "string" ? e.reason : "",
      ...(e.gone === true ? { gone: true } : {}),
    });
  }
  return out;
}

/** The entries a retry can still do something about. */
export function retryableMissing(missing: MissingPhoto[] | null): MissingPhoto[] {
  return (missing ?? []).filter((m) => !m.gone);
}

/**
 * The ids a job's failure log names. This is the nomination for a first run's
 * sweep; `sps-pull-audit.ts` uses it the same way on jobs from before the
 * sweep existed.
 */
export function readFailureLog(value: unknown): { spsImageId: string; filename: string }[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: { spsImageId: string; filename: string }[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.spsImageId !== "string" || !e.spsImageId || seen.has(e.spsImageId)) continue;
    seen.add(e.spsImageId);
    out.push({
      spsImageId: e.spsImageId,
      filename: typeof e.filename === "string" ? e.filename : e.spsImageId,
    });
  }
  return out;
}

/** What a sweep is allowed to touch. */
export interface SweepPlan {
  /** Photos to fetch if they turn out to be absent. */
  fetch: MissingPhoto[];
  /**
   * Photos to look at: `fetch`, plus every photo the failure log names. One
   * that is here but was never reported to SPS gets reported. Never fetched:
   * a logged failure that landed and was later removed by a person stays
   * removed.
   */
  watch: string[];
  /** Entries already known to be unfetchable, carried into the next record. */
  carried: MissingPhoto[];
}

/**
 * Decide what this run's sweep covers, from the job row alone.
 *
 * A job that already has a stored list is being RETRIED: fetch that list. A
 * job without one is finishing its first run: fetch what the walk failed on.
 * Keyed on the stored list, not on how the run was started, so a restart in
 * the middle of either lands on the same answer.
 */
export function planSweep(job: { missing: unknown; failures: unknown }): SweepPlan {
  const stored = readMissing(job.missing);
  const logged = readFailureLog(job.failures);
  const fetch: MissingPhoto[] = stored
    ? retryableMissing(stored)
    : logged.map((f) => ({ ...f, reason: "" }));
  const watch = new Set<string>(fetch.map((f) => f.spsImageId));
  for (const f of logged) watch.add(f.spsImageId);
  return {
    fetch,
    watch: [...watch],
    carried: (stored ?? []).filter((m) => m.gone),
  };
}

/** Read the job's two lists and plan the sweep. */
export async function loadSweepPlan(
  supabase: SupabaseDB,
  jobId: string
): Promise<SweepPlan> {
  const { data, error } = await supabase
    .from("sps_pull_jobs")
    .select("missing, failures")
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Pull job ${jobId} vanished`);
  return planSweep(data);
}

/**
 * The photos on one manifest page that this pass may look at: what the review
 * kept, narrowed to `watch`. A null `watch` means every photo on the page, and
 * only the audit script asks for that.
 */
export function sweepCandidates(
  images: SpsManifestImage[],
  deselected: Iterable<string>,
  watch: ReadonlySet<string> | null
): SpsManifestImage[] {
  const excluded = new Set(deselected);
  return images.filter(
    (img) => !excluded.has(img.id) && (watch === null || watch.has(img.id))
  );
}

/**
 * Which absent photos to attempt in this step.
 *
 * `fetch` is the nomination (null = every candidate, audit only). `skip` is
 * what already failed in THIS run: one more try each, not a loop. The `limit`
 * keeps a step inside the execution ceiling when hundreds are absent (a page
 * is 500 photos, about twelve minutes of copying); `more` tells the caller to
 * come back to the same page.
 */
export function planSweepPage(input: {
  candidates: SpsManifestImage[];
  present: ReadonlySet<string>;
  fetch: ReadonlySet<string> | null;
  skip: ReadonlySet<string>;
  limit: number;
}): { absent: SpsManifestImage[]; batch: SpsManifestImage[]; more: boolean } {
  const absent = input.candidates.filter((img) => !input.present.has(img.id));
  const todo = absent.filter(
    (img) => (input.fetch === null || input.fetch.has(img.id)) && !input.skip.has(img.id)
  );
  return {
    absent,
    batch: todo.slice(0, input.limit),
    more: todo.length > input.limit,
  };
}

interface PresentRow {
  spsImageId: string;
  r2Key: string;
  complete: boolean;
  reported: boolean;
}

/** The rows the event already has for these SPS ids. */
async function presentRows(
  supabase: SupabaseDB,
  eventId: string,
  ids: string[]
): Promise<Map<string, PresentRow>> {
  const present = new Map<string, PresentRow>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("images")
      .select("sps_image_id, r2_key, processing_status, sps_pulled_at")
      .eq("event_id", eventId)
      .in("sps_image_id", ids.slice(i, i + ID_CHUNK));
    if (error) throw error;
    for (const row of data ?? []) {
      if (!row.sps_image_id) continue;
      present.set(row.sps_image_id, {
        spsImageId: row.sps_image_id,
        r2Key: row.r2_key,
        complete: row.processing_status === "complete",
        reported: row.sps_pulled_at !== null,
      });
    }
  }
  return present;
}

/** The ids among `rows` whose object is really in R2. */
async function provedInR2(rows: PresentRow[]): Promise<string[]> {
  // `objectExistsInR2` answers false on ANY error, which is the safe direction
  // both times this is used: an unproved photo is not reported to SPS, and an
  // unproved "it landed after all" stays on the missing list.
  const proved: string[] = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(HEAD_CONCURRENCY, rows.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= rows.length) return;
        if (rows[index].r2Key && (await objectExistsInR2(rows[index].r2Key))) {
          proved.push(rows[index].spsImageId);
        }
      }
    })
  );
  return proved;
}

/**
 * `confirmDurable`, a chunk at a time: it stamps rows with an `.in()` filter,
 * and a page can hold more proved ids than a URL should carry.
 */
async function confirmInChunks(
  supabase: SupabaseDB,
  token: string,
  job: SpsPullJob,
  durable: string[]
): Promise<number> {
  let confirmed = 0;
  for (let i = 0; i < durable.length; i += ID_CHUNK) {
    const slice: SliceResult = {
      imported: 0,
      failed: 0,
      skipped: 0,
      bytes: 0,
      confirmed: 0,
      pageSize: 0,
      nextOffset: null,
    };
    await confirmDurable(supabase, token, job, durable.slice(i, i + ID_CHUNK), slice);
    confirmed += slice.confirmed;
  }
  return confirmed;
}

export interface AbsentOnPage {
  token: string;
  candidates: SpsManifestImage[];
  present: Map<string, PresentRow>;
  absent: SpsManifestImage[];
  batch: SpsManifestImage[];
  more: boolean;
  nextOffset: number | null;
}

/**
 * One manifest page against the event's rows. Read-only: this is the whole of
 * the audit, and the first half of a sweep step.
 */
export async function findAbsentOnPage(
  supabase: SupabaseDB,
  job: SpsPullJob,
  offset: number,
  opts: { watch: string[] | null; fetch: string[] | null; skip: string[] }
): Promise<AbsentOnPage> {
  const token = await getSpsToken(supabase, job.user_id);
  if (!token) throw new Error("SPS connection is gone — nothing to pull with.");

  const page = await fetchManifestPage(token, job.sps_event_id, offset);
  const candidates = sweepCandidates(
    page.images,
    job.deselected ?? [],
    opts.watch ? new Set(opts.watch) : null
  );
  const present = await presentRows(
    supabase,
    job.event_id,
    candidates.map((c) => c.id)
  );
  const plan = planSweepPage({
    candidates,
    present: new Set(present.keys()),
    fetch: opts.fetch ? new Set(opts.fetch) : null,
    skip: new Set(opts.skip),
    limit: IMPORT_SLICE,
  });

  return { token, candidates, present, ...plan, nextOffset: page.nextOffset ?? null };
}

export interface SweepPageResult {
  imported: number;
  /** Attempted in this step and still not here. */
  failed: MissingPhoto[];
  /** The watched ids this page accounted for (here or not). */
  seen: string[];
  /** Absent photos remain on this page beyond the step's limit. */
  more: boolean;
  /** Absent on the last manifest page. */
  nextOffset: number | null;
}

/**
 * One step of the sweep, for one manifest page: fetch the nominated photos
 * that are absent, once each, and report to SPS any watched photo that is here
 * and proved but was never reported.
 */
export async function sweepPage(
  supabase: SupabaseDB,
  job: SpsPullJob,
  offset: number,
  opts: { watch: string[]; fetch: string[]; skip: string[] }
): Promise<SweepPageResult> {
  const found = await findAbsentOnPage(supabase, job, offset, opts);
  const result: SweepPageResult = {
    imported: 0,
    failed: [],
    seen: found.candidates.map((c) => c.id),
    more: found.more,
    nextOffset: found.nextOffset,
  };

  const blank: SliceResult = {
    imported: 0,
    failed: 0,
    skipped: 0,
    bytes: 0,
    confirmed: 0,
    pageSize: 0,
    nextOffset: null,
  };
  const fold = (slice: Partial<SliceResult>) =>
    // Never the offset: the sweep reads pages, it does not own the walk.
    applySliceResult(supabase, job.id, { ...blank, ...slice }, null);

  // Here, complete, never reported: prove the object, then report. These are
  // photos whose import threw after the row was written (the reconciler
  // finished them) and photos whose `/pulled` call failed.
  const durable = await provedInR2(
    [...found.present.values()].filter((row) => row.complete && !row.reported)
  );

  if (!found.batch.length) {
    // Folded even when it is all zeros: a page with nothing to do still proves
    // the run is alive, and the watchdog judges a stall by how long the row
    // has been quiet.
    await fold({
      confirmed: await confirmInChunks(supabase, found.token, job, durable),
    });
    return result;
  }

  const { sectionId, sortBase } = await intakeAppendPoint(supabase, job.event_id);

  const totals: ProgressCounters = { imported: 0, failed: 0, skipped: 0, bytes: 0 };
  const flusher = createProgressFlusher((delta) => fold(delta));
  const threw: MissingPhoto[] = [];
  let sinceFlush = 0;
  let cursor = 0;

  await Promise.all(
    Array.from(
      { length: Math.min(IMPORT_CONCURRENCY, found.batch.length) },
      async () => {
        for (;;) {
          const index = cursor++;
          if (index >= found.batch.length) return;
          const img = found.batch[index];
          try {
            const outcome = await importOneImage(supabase, job, {
              image: img,
              sectionId,
              sortOrder: sortBase + index,
            });
            if (outcome.status === "imported") {
              totals.imported++;
              totals.bytes += outcome.bytes;
              durable.push(img.id);
            } else {
              totals.skipped++;
            }
          } catch (err) {
            totals.failed++;
            threw.push({
              spsImageId: img.id,
              filename: img.originalFilename,
              reason: describeError(err),
            });
          }
          if (++sinceFlush >= PROGRESS_FLUSH_EVERY) {
            sinceFlush = 0;
            await flusher.flush(totals);
          }
        }
      }
    )
  );
  await flusher.flush(totals);
  result.imported = totals.imported;

  // A throw is not an absence. `importOneImage` can fail AFTER the row is
  // written (the last update timing out is exactly what happened on AAOMS),
  // and listing that photo as missing would be this module repeating the bug
  // it exists to fix. So look again, and believe a row only with its object.
  if (threw.length) {
    const after = await presentRows(
      supabase,
      job.event_id,
      threw.map((t) => t.spsImageId)
    );
    const landed = new Set(await provedInR2([...after.values()]));
    result.failed = threw.filter((t) => !landed.has(t.spsImageId));
  }

  const confirmed = await confirmInChunks(supabase, found.token, job, durable);
  if (confirmed) {
    try {
      await fold({ confirmed });
    } catch (err) {
      console.error("SPS pull sweep confirm-count flush failed:", err);
    }
  }

  return result;
}

/**
 * The nominated photos a sweep never reached, as entries for the next record.
 *
 * Two different reasons, and they must not be confused. When the sweep read
 * the manifest to its end and never met a photo, SPS no longer lists it:
 * `gone`, nothing left to fetch. When the sweep itself could not run (SPS
 * unreachable, the connection revoked), the photo is simply still owed and
 * stays retryable, with the reason. Dropping either would read as "recovered".
 */
export function unresolvedEntries(
  fetch: MissingPhoto[],
  unseen: ReadonlySet<string>,
  sweepError: string | null
): MissingPhoto[] {
  return fetch
    .filter((m) => unseen.has(m.spsImageId))
    .map((m) =>
      sweepError
        ? { spsImageId: m.spsImageId, filename: m.filename, reason: `The retry could not run: ${sweepError}` }
        : { spsImageId: m.spsImageId, filename: m.filename, reason: GONE_REASON, gone: true }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Asking for a retry
// ─────────────────────────────────────────────────────────────────────────────

export type RetryPullResult =
  | { ok: true; eventId: string; jobId: string; count: number }
  | {
      ok: false;
      reason: "not-found" | "not-connected" | "in-progress" | "not-finished" | "nothing-missing";
      message: string;
    };

/**
 * Re-queue a FINISHED job to fetch the photos its sweep left behind.
 *
 * Not `startSpsPull`: that answers "already imported" for a completed job on
 * purpose (a second Import press must not start a second walk), and a
 * cancelled or failed job resumes through it already.
 *
 * `userId` is the authorization. The caller holds the service client, so the
 * filter on every statement here is what stops one account re-queuing another's
 * job.
 */
export async function requestMissingRetry(
  supabase: SupabaseDB,
  userId: string,
  jobId: string
): Promise<RetryPullResult> {
  const { data: job, error } = await supabase
    .from("sps_pull_jobs")
    .select("id, event_id, status, missing, finished_at, walked_at")
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!job) {
    return { ok: false, reason: "not-found", message: "Import not found." };
  }
  if (job.status === "queued" || job.status === "running") {
    return { ok: false, reason: "in-progress", message: "This import is already running." };
  }
  if (job.status !== "completed") {
    return {
      ok: false,
      reason: "not-finished",
      message: "This import was stopped part-way. Resume it instead.",
    };
  }

  const todo = retryableMissing(readMissing(job.missing));
  if (!todo.length) {
    return {
      ok: false,
      reason: "nothing-missing",
      message: "Nothing is waiting to be fetched for this import.",
    };
  }

  const token = await getSpsToken(supabase, userId);
  if (!token) {
    return {
      ok: false,
      reason: "not-connected",
      message: "Connect SimplePhotoShare first (Account → Connections).",
    };
  }

  // Conditional on still being completed: a double press re-queues once.
  const { data: queued, error: queueErr } = await supabase
    .from("sps_pull_jobs")
    .update({
      status: "queued",
      error: null,
      finished_at: null,
      updated_at: new Date().toISOString(),
      // A completed job has finished its walk by definition. Said here as well
      // as in migration 093's backfill, so a job that predates the column can
      // never be re-walked by a retry.
      walked_at: job.walked_at ?? job.finished_at ?? new Date().toISOString(),
      // A fresh attempt, with a fresh restart budget (see startSpsPull).
      watchdog_restarts: 0,
      watchdog_mark: null,
      watchdog_at: null,
      watchdog_alerted_at: null,
    })
    .eq("id", jobId)
    .eq("user_id", userId)
    .eq("status", "completed")
    .select("id")
    .maybeSingle();
  if (queueErr) throw queueErr;
  if (!queued) {
    return { ok: false, reason: "in-progress", message: "This import is already running." };
  }

  try {
    await inngest.send({ name: "sps/pull.requested", data: { jobId } });
  } catch (err) {
    // Nothing is running, so put the job back exactly as it was. Leaving it
    // "queued" would show a retry in progress for the half hour it takes the
    // watchdog to notice there is no run behind it.
    await supabase
      .from("sps_pull_jobs")
      .update({
        status: "completed",
        finished_at: job.finished_at,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", userId)
      .eq("status", "queued");
    throw err;
  }

  return { ok: true, eventId: job.event_id, jobId, count: todo.length };
}

/** `MissingPhoto[]` as the jsonb the column takes. */
export function missingAsJson(missing: MissingPhoto[]): Json {
  return missing as unknown as Json;
}
