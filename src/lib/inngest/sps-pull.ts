import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  applySliceResult,
  dispatchPullSettlement,
  finishJob,
  importSlice,
  isPageDrained,
  loadPullJob,
  markJobRunning,
} from "@/lib/sps-integration/pull-event";

/**
 * The SPS pull lane — moves an event's camera files into the archive.
 *
 * Shape of the run: walk the SPS manifest a page at a time, and each page in
 * slices of IMPORT_SLICE images, one Inngest step per slice.
 *
 * Why slices instead of one step per page: a page is 500 images, which at real
 * file sizes can exceed the execution route's ceiling. A slice re-fetches its
 * manifest page — one extra request — which is also what keeps every signed URL
 * seconds old rather than up to an hour. A retried step re-imports nothing: the
 * importer skips images already in the event, and confirms any that landed on
 * the previous attempt but never reached SPS's /pulled.
 *
 * Resumption needs no run state. `next_offset` on the job row advances only when
 * a page is fully drained, so a continued or re-triggered job re-walks at most
 * one page.
 */

/** Slices per run before handing off to a fresh one. Keeps memoized run state
 *  small on a multi-thousand-image event (~4,000 images per run at 100/slice). */
const MAX_SLICES_PER_RUN = 40;

/** A page's slice count is bounded by SPS's page size — a guard against a
 *  malformed page count spinning the inner loop. */
const MAX_SLICES_PER_PAGE = 20;

export const spsPull = inngest.createFunction(
  {
    id: "sps-pull",
    // The import is idempotent per image, so a retry is safe; but the bytes are
    // expensive, so don't thrash.
    retries: 2,
    // One worker per job, by construction. The counter fold is a
    // read-modify-write and the slice loop assumes nothing else is advancing
    // `next_offset` underneath it.
    concurrency: { limit: 1, key: "event.data.jobId" },
  },
  { event: "sps/pull.requested" },
  async ({ event, step }) => {
    const { jobId } = event.data;

    const snapshot = await step.run("load-job", async () => {
      const supabase = createServiceClient();
      const job = await loadPullJob(supabase, jobId);
      if (!job) throw new NonRetriableError(`Pull job ${jobId} not found`);
      return job;
    });

    // A finished or abandoned job must not restart just because the event was
    // re-sent (a manual re-trigger, an Inngest replay).
    if (snapshot.status === "completed" || snapshot.status === "cancelled") {
      return { jobId, status: snapshot.status, skipped: true };
    }

    await step.run("mark-running", async () => {
      await markJobRunning(createServiceClient(), jobId);
    });

    let offset = snapshot.next_offset;
    let slicesUsed = 0;

    for (;;) {
      // ── One manifest page, in slices ──
      let sliceIndex = 0;
      let pageNextOffset: number | null = null;

      for (;;) {
        const outcome = await step.run(
          `import-${offset}-${sliceIndex}`,
          async () => {
            const supabase = createServiceClient();
            const job = await loadPullJob(supabase, jobId);
            if (!job) throw new NonRetriableError(`Pull job ${jobId} vanished`);
            // Cancellation is honoured between slices — the photographer's stop
            // lands within one slice rather than at the end of the import.
            if (job.status === "cancelled") {
              return { cancelled: true as const };
            }

            const slice = await importSlice(supabase, job, offset, sliceIndex);
            const pageDone = isPageDrained(sliceIndex, slice.pageSize);

            // importSlice folds its own counters as it goes (so the progress
            // screen moves every few photos instead of once per 100). All that
            // is left here is the offset, which only advances on a fully
            // drained page — a resume then re-walks this page and skips what it
            // already holds.
            if (pageDone) {
              await applySliceResult(
                supabase,
                jobId,
                slice.alreadyFolded
                  ? { ...slice, imported: 0, failed: 0, skipped: 0, bytes: 0, confirmed: 0 }
                  : slice,
                slice.nextOffset
              );
            } else if (!slice.alreadyFolded) {
              await applySliceResult(supabase, jobId, slice, null);
            }

            return {
              cancelled: false as const,
              pageDone,
              nextOffset: slice.nextOffset,
              imported: slice.imported,
              failed: slice.failed,
              skipped: slice.skipped,
            };
          }
        );

        if (outcome.cancelled) {
          return { jobId, status: "cancelled" };
        }

        slicesUsed++;

        if (outcome.pageDone) {
          pageNextOffset = outcome.nextOffset;
          break;
        }
        if (++sliceIndex >= MAX_SLICES_PER_PAGE) {
          // Cannot happen against a spec-conforming 500-image page; if it does,
          // stop rather than loop, and say so loudly.
          throw new NonRetriableError(
            `Manifest page at offset ${offset} exceeded ${MAX_SLICES_PER_PAGE} slices`
          );
        }
      }

      // Absent nextOffset is the terminator — never a count comparison, since
      // SPS's imageCount includes AI copies the manifest excludes.
      if (pageNextOffset === null) break;

      offset = pageNextOffset;

      if (slicesUsed >= MAX_SLICES_PER_RUN) {
        await step.sendEvent("continue-pull", {
          name: "sps/pull.requested",
          data: { jobId },
        });
        return { jobId, status: "continued", nextOffset: offset };
      }
    }

    const summary = await step.run("finish", async () => {
      const supabase = createServiceClient();
      const job = await loadPullJob(supabase, jobId);
      if (!job) throw new NonRetriableError(`Pull job ${jobId} vanished`);

      await finishJob(supabase, jobId, { status: "completed" });

      // Settlement fires once, at the end: both lanes debounce per event, and
      // 6,000 sends saying the same thing is a way to get rate limited.
      await dispatchPullSettlement(supabase, job);

      return {
        imported: job.images_done,
        failed: job.images_failed,
        skipped: job.images_skipped,
        bytes: job.bytes_copied,
        confirmed: job.confirmed,
      };
    });

    // A partial import is a real outcome, not a silent one: the job row keeps
    // per-image reasons, and this makes it queryable + emails the admin.
    if (summary.failed > 0) {
      await step.run("report-partial", async () => {
        await reportSystemError(
          "sps.pull-partial",
          new Error(
            `SPS pull finished with ${summary.failed} failed of ${summary.failed + summary.imported}`
          ),
          { jobId, eventId: snapshot.event_id, spsEventId: snapshot.sps_event_id }
        );
      });
    }

    return { jobId, status: "completed", ...summary };
  }
);
