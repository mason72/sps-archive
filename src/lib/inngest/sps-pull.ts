import { NonRetriableError } from "inngest";
import { inngest } from "./client";
import { createServiceClient } from "@/lib/supabase/server";
import { describeError, reportSystemError } from "@/lib/monitoring/report";
import {
  applySliceResult,
  countExpectedTotal,
  dispatchPullSettlement,
  finishJob,
  importSlice,
  isPageDrained,
  loadPullJob,
  markJobRunning,
  markWalked,
} from "@/lib/sps-integration/pull-event";
import {
  loadSweepPlan,
  missingAsJson,
  sweepPage,
  unresolvedEntries,
  type MissingPhoto,
} from "@/lib/sps-integration/pull-sweep";
import { decideWatchdog } from "@/lib/sps-integration/pull-watchdog";
import { cancelLiveRuns } from "./rest";

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
 *
 * The run ends with the CLOSING SWEEP (pull-sweep.ts): each photo the walk
 * failed on gets one more try, and what is still absent is stored on the job
 * as `missing`. A job is never "completed" without having said what it left
 * behind. A finished job re-queued by the import screen's Retry skips the walk
 * (`walked_at` is set) and sweeps its stored list. A clean import nominates
 * nothing, so its sweep reads no manifest page at all.
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

    // Establish the denominator, once, from the manifest itself. The client
    // cannot supply it: it only knows how many pages it has scrolled through, so
    // on a 9,000-photo event the total depended on whether the photographer
    // happened to reach the bottom of the grid. A multi-hour import with no total
    // is the "looks stalled" failure by another route.
    if (snapshot.expected_total === null) {
      await step.run("count-total", async () => {
        const supabase = createServiceClient();
        const job = await loadPullJob(supabase, jobId);
        if (!job) throw new NonRetriableError(`Pull job ${jobId} vanished`);
        return { expectedTotal: await countExpectedTotal(supabase, job) };
      });
    }

    let offset = snapshot.next_offset;
    let slicesUsed = 0;

    // A job whose walk already reached the last page goes straight to the
    // sweep: a Retry from the import screen, or a restart during the sweep.
    // `!= null`, not `!== null`: a run already in flight when this shipped has
    // a memoized snapshot with no such key, and that must read as "not walked".
    const walked = snapshot.walked_at != null;

    while (!walked) {
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

    if (!walked) {
      await step.run("walk-done", async () => {
        await markWalked(createServiceClient(), jobId);
      });
    }

    // ── The closing sweep ──
    //
    // The plan says what may be fetched (the walk's failures, or on a retry
    // the stored list) and what is merely looked at. Nothing outside it is
    // touched: the gallery may have been curated, and a photo that is absent
    // because a person removed it must stay absent.
    const plan = await step.run("sweep-plan", async () =>
      loadSweepPlan(createServiceClient(), jobId)
    );
    const fetchIds = plan.fetch.map((m) => m.spsImageId);
    const awaiting = new Set(plan.watch);
    const stillMissing: MissingPhoto[] = [];
    let recovered = 0;
    let sweepOffset = 0;
    let sweepError: string | null = null;

    // A sweep that cannot run must not strand the job. Every step here has
    // already had its retries by the time it throws, and the walk is done: the
    // right ending is "completed, and these are still owed", not a job left
    // "running" for the watchdog to restart into the same wall (a deleted SPS
    // event, a revoked connection).
    try {
      while (awaiting.size > 0) {
        let pageNextOffset: number | null = null;

        for (let pass = 0; ; pass++) {
          const outcome = await step.run(`sweep-${sweepOffset}-${pass}`, async () => {
            const supabase = createServiceClient();
            const job = await loadPullJob(supabase, jobId);
            if (!job) throw new NonRetriableError(`Pull job ${jobId} vanished`);
            if (job.status === "cancelled") return { cancelled: true as const };
            const page = await sweepPage(supabase, job, sweepOffset, {
              watch: plan.watch,
              fetch: fetchIds,
              // One more try each, not a loop: what failed in this run is left.
              skip: stillMissing.map((m) => m.spsImageId),
            });
            return { cancelled: false as const, ...page };
          });

          if (outcome.cancelled) {
            return { jobId, status: "cancelled" };
          }

          stillMissing.push(...outcome.failed);
          recovered += outcome.imported;
          pageNextOffset = outcome.nextOffset;

          if (!outcome.more) {
            // Only once the page is finished: a photo waiting for the next
            // pass has been met, not dealt with.
            for (const id of outcome.seen) awaiting.delete(id);
            break;
          }
          if (pass + 1 >= MAX_SLICES_PER_PAGE) {
            throw new NonRetriableError(
              `Sweep of manifest page ${sweepOffset} exceeded ${MAX_SLICES_PER_PAGE} passes`
            );
          }
        }

        if (pageNextOffset === null) break;
        sweepOffset = pageNextOffset;
      }
    } catch (err) {
      sweepError = describeError(err);
      await step.run("report-sweep-failed", async () => {
        await reportSystemError("sps.pull-sweep", err, {
          jobId,
          eventId: snapshot.event_id,
          owed: awaiting.size,
        });
      });
    }

    // Nominated and never dealt with: gone from SPS if the manifest was read to
    // its end, still owed if the sweep could not run. Either way it stays on
    // the job rather than vanishing as if recovered.
    const failedIds = new Set(stillMissing.map((m) => m.spsImageId));
    stillMissing.push(
      ...unresolvedEntries(
        plan.fetch.filter((m) => !failedIds.has(m.spsImageId)),
        awaiting,
        sweepError
      ),
      ...plan.carried
    );

    const summary = await step.run("finish", async () => {
      const supabase = createServiceClient();
      const job = await loadPullJob(supabase, jobId);
      if (!job) throw new NonRetriableError(`Pull job ${jobId} vanished`);

      // A stop that landed after the last sweep step is still a stop, and
      // `finishJob` will not write "completed" over one.
      const finished = await finishJob(supabase, jobId, {
        status: "completed",
        missing: missingAsJson(stillMissing),
      });
      if (!finished) return null;

      // Settlement fires once, at the end: both lanes debounce per event, and
      // 6,000 sends saying the same thing is a way to get rate limited.
      await dispatchPullSettlement(supabase, job);

      // The delivery recap is complete once the event has wrapped, and SPS
      // keeps the event for only ~3 months, so this is the moment to take the
      // durable copy. Best effort: a pull is finished whether or not the
      // numbers came across, and the share page can refresh them later.
      try {
        const { snapshotRecap } = await import("@/lib/recap/snapshot");
        const outcome = await snapshotRecap(supabase, job.event_id);
        if (outcome.kind === "failed") {
          await reportSystemError("sps-pull:recap", outcome.message, {
            eventId: job.event_id,
          });
        }
      } catch (err) {
        await reportSystemError("sps-pull:recap", err, { eventId: job.event_id });
      }

      return {
        imported: job.images_done,
        failed: job.images_failed,
        skipped: job.images_skipped,
        bytes: job.bytes_copied,
        confirmed: job.confirmed,
      };
    });

    if (!summary) return { jobId, status: "cancelled" };

    // A partial import is a real outcome, not a silent one. The count is what
    // the sweep could not bring over, never the failure counter: that counts
    // attempts, and a photo that failed once and landed on the second try is
    // not missing.
    if (stillMissing.length > 0) {
      await step.run("report-partial", async () => {
        const names = stillMissing.slice(0, 10).map((m) => `${m.filename} (${m.reason})`);
        await reportSystemError(
          "sps.pull-partial",
          new Error(
            `SPS pull finished with ${stillMissing.length} photo(s) not brought over: ${names.join("; ")}` +
              `${stillMissing.length > names.length ? "; …" : ""}. Retry from /events/import.`
          ),
          { jobId, eventId: snapshot.event_id, spsEventId: snapshot.sps_event_id }
        );
      });
    }

    return {
      jobId,
      status: "completed",
      ...summary,
      recovered,
      missing: stillMissing.length,
    };
  }
);

/**
 * The pull watchdog — a stalled import heals itself, and says so only when it
 * cannot (2026-09-18, after Autodesk University 2026 sat frozen for 4h20m on a
 * zombie run nobody was told about). Decision rules and their reasons live in
 * `decideWatchdog()`; this is only the plumbing.
 *
 * The remedy is the one proven by hand that day: cancel the job's live runs
 * (the zombie holds the one concurrency slot, so a bare re-send would queue
 * behind it forever), wait for the slot to free, re-send. A re-send is a
 * resume, never a second import — `next_offset` is the resume point and the
 * (event_id, sps_image_id) unique index skips anything already landed.
 */
export const spsPullWatchdog = inngest.createFunction(
  // One at a time: the cron and the manual trigger must never both restart
  // the same job, or the second cancel can land on the first one's re-send.
  { id: "sps-pull-watchdog", retries: 1, concurrency: { limit: 1 } },
  // :03 :18 :33 :48 — off the ai-index sweep (:07/:37) and the digest (:00/:30).
  [{ cron: "3,18,33,48 * * * *" }, { event: "sps/pull-watchdog.run" }],
  async ({ step }) => {
    const verdicts = await step.run("inspect", async () => {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("sps_pull_jobs")
        .select(
          "id, event_id, sps_event_name, status, created_at, updated_at, images_done, images_failed, images_skipped, expected_total, watchdog_restarts, watchdog_mark, watchdog_at, watchdog_alerted_at"
        )
        .in("status", ["queued", "running"])
        .order("created_at", { ascending: true });
      // An error here reads as "no live imports" — a healthy empty answer.
      // Say so instead, or the watchdog goes blind silently.
      if (error) {
        await reportSystemError("sps.pull-watchdog", error, { note: "job list read failed; no jobs checked" });
        return [];
      }
      const now = new Date();
      return (data ?? []).map((job) => ({ job, verdict: decideWatchdog(job, now) }));
    });

    let restarted = 0;
    let alerted = 0;

    for (const { job, verdict } of verdicts) {
      if (verdict.action === "restart") {
        const outcome = await step.run(`restart-${job.id}-${verdict.restarts}`, async () => {
          const supabase = createServiceClient();
          // The verdict is memoized and may be minutes old by now (earlier jobs'
          // settle sleeps). If the row moved since inspect, the job woke up on
          // its own: back off rather than cancel a run that is working.
          const { data: fresh, error: freshErr } = await supabase
            .from("sps_pull_jobs")
            .select("status, updated_at, watchdog_at")
            .eq("id", job.id)
            .maybeSingle();
          if (freshErr) throw freshErr;
          if (
            !fresh ||
            (fresh.status !== "running" && fresh.status !== "queued") ||
            fresh.updated_at !== job.updated_at ||
            fresh.watchdog_at !== job.watchdog_at
          ) {
            return { resend: false, reason: "moved" };
          }

          // Record the intervention FIRST: a crash between here and the re-send
          // then costs one missed restart, never a double one.
          const { error } = await supabase
            .from("sps_pull_jobs")
            .update({
              watchdog_restarts: verdict.restarts,
              watchdog_mark: verdict.mark,
              watchdog_at: new Date().toISOString(),
              watchdog_alerted_at: null,
            })
            .eq("id", job.id);
          if (error) throw error;

          try {
            // A live run's triggering event is at most one run's length old
            // (~2–3h); 12h is generous, and bounded so a job created days ago
            // (then resumed) does not list every pull event since.
            const since = Math.max(Date.parse(job.created_at), Date.now() - 12 * 3_600_000) - 60_000;
            const runs = await cancelLiveRuns({
              eventName: "sps/pull.requested",
              key: "jobId",
              value: job.id,
              since: new Date(since),
            });
            console.log(`[sps-pull-watchdog] ${job.id} stalled`, runs);
            if (runs.errors.length) {
              await reportSystemError(
                "sps.pull-watchdog.cancel",
                new Error(`Could not cancel ${runs.errors.length} run(s): ${runs.errors.join("; ")}`),
                { jobId: job.id }
              );
            }
            // A run already waiting for the slot will pick the job up the
            // moment the zombie is gone; a second event would only queue behind.
            return runs.waiting.length
              ? { resend: false, reason: "run-waiting" }
              : { resend: true, reason: "restarted" };
          } catch (err) {
            // Could not even look. Still re-send: if no zombie exists (the run
            // died outright) the re-send alone fixes it, and if one does it only
            // queues. Loud, because a watchdog that cannot cancel is half a fix.
            await reportSystemError("sps.pull-watchdog.cancel", err, { jobId: job.id });
            return { resend: true, reason: "restarted-blind" };
          }
        });
        if (outcome.reason === "moved") continue;
        restarted++;
        if (!outcome.resend) continue;
        // Cancellation releases the concurrency slot asynchronously.
        await step.sleep(`settle-${job.id}-${verdict.restarts}`, "20s");
        await step.sendEvent(`resend-${job.id}-${verdict.restarts}`, {
          name: "sps/pull.requested",
          data: { jobId: job.id },
        });
      } else if (verdict.action === "alert") {
        await step.run(`alert-${job.id}-${verdict.mark}`, async () => {
          await reportSystemError(
            "sps.pull-stalled",
            new Error(
              `SPS import "${job.sps_event_name ?? job.event_id}" is stuck at ${verdict.mark}` +
                `${job.expected_total ? ` of ${job.expected_total}` : ""} photos — ` +
                `${verdict.restarts} automatic restarts did not move it (quiet ${verdict.stalledMinutes} min)`
            ),
            { jobId: job.id, eventId: job.event_id, mark: verdict.mark }
          );
          const { error } = await createServiceClient()
            .from("sps_pull_jobs")
            .update({ watchdog_alerted_at: new Date().toISOString() })
            .eq("id", job.id);
          if (error) throw error;
        });
        alerted++;
      }
    }

    return { checked: verdicts.length, restarted, alerted };
  }
);
