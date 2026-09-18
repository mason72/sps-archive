/**
 * The SPS pull watchdog's decision — pure, so every branch is testable.
 *
 * Born 2026-09-18: Autodesk University 2026 sat at 4,088 of 6,110 for 4h20m on
 * a zombie Inngest run (status "Running", nothing executing). sps-pull allows
 * one run per job, so the zombie also held the only slot and a plain re-send
 * would have queued behind it forever. Nothing reported it.
 *
 * The rule: a job whose row has not moved for STALL_MINUTES is stalled. The row
 * is written every 5 photos (PROGRESS_FLUSH_EVERY) and slices take minutes, so
 * that much silence is never a slow batch. One safe remedy — cancel the job's
 * live runs, re-send it (idempotent: the unique index skips what landed) — at
 * most WATCHDOG_MAX_RESTARTS times, then one alert, then hands off. Progress
 * past the last intervention resets the budget, so a stall hours later gets
 * its own restarts.
 */

export const WATCHDOG_STALL_MINUTES = 30;
export const WATCHDOG_MAX_RESTARTS = 2;

export interface WatchdogJob {
  status: string;
  updated_at: string;
  images_done: number;
  watchdog_restarts: number;
  watchdog_mark: number | null;
  watchdog_at: string | null;
  watchdog_alerted_at: string | null;
}

export type WatchdogVerdict =
  /** Moving, or not quiet long enough to judge. */
  | { action: "ok" }
  /** Cancel live runs and re-send. `restarts` is the value to store. */
  | { action: "restart"; restarts: number; mark: number }
  /** Restarts spent and still stuck: tell a human, once. */
  | { action: "alert"; restarts: number; mark: number; stalledMinutes: number }
  /** Already alerted about this stall; a human has it. */
  | { action: "handed-off" };

/**
 * Progress for the watchdog is photos IMPORTED, nothing else. A restart
 * re-walks the half-drained page from `next_offset`, re-counting every photo
 * that already landed there as "skipped" and re-failing any that failed — so
 * counting those would read a restart's own re-walk as recovery, reset the
 * budget forever, and the alert would never fire (caught in review).
 */
export function progressCount(job: WatchdogJob): number {
  return job.images_done;
}

export function decideWatchdog(job: WatchdogJob, now: Date): WatchdogVerdict {
  if (job.status !== "running" && job.status !== "queued") return { action: "ok" };

  const progress = progressCount(job);

  // Photos landed since the last intervention: that restart worked, and this
  // (if it is a stall at all) is a new one with a fresh budget.
  const recovered = job.watchdog_mark !== null && progress > job.watchdog_mark;
  const restarts = recovered ? 0 : job.watchdog_restarts;
  const alerted = recovered ? false : job.watchdog_alerted_at !== null;

  // A restart re-runs mark-running, which touches updated_at without moving a
  // photo — so measure quiet from whichever is later, and judge recovery by
  // the progress count above, never by the timestamp.
  const lastSignal = Math.max(
    Date.parse(job.updated_at),
    (job.watchdog_at && Date.parse(job.watchdog_at)) || 0
  );
  const stalledMinutes = (now.getTime() - lastSignal) / 60_000;
  if (!(stalledMinutes >= WATCHDOG_STALL_MINUTES)) return { action: "ok" };

  if (restarts < WATCHDOG_MAX_RESTARTS) {
    return { action: "restart", restarts: restarts + 1, mark: progress };
  }
  if (!alerted) {
    return {
      action: "alert",
      restarts,
      mark: progress,
      stalledMinutes: Math.round(stalledMinutes),
    };
  }
  return { action: "handed-off" };
}
