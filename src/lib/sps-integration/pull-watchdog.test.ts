import { describe, expect, it } from "vitest";
import {
  decideWatchdog,
  WATCHDOG_MAX_RESTARTS,
  WATCHDOG_STALL_MINUTES,
  type WatchdogJob,
} from "./pull-watchdog";

const NOW = new Date("2026-09-18T21:30:00Z");
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

/** The Autodesk job as it actually sat on 2026-09-18: 4h20m quiet at 4,088. */
function job(over: Partial<WatchdogJob> = {}): WatchdogJob {
  return {
    status: "running",
    updated_at: minsAgo(260),
    images_done: 4088,
    watchdog_restarts: 0,
    watchdog_mark: null,
    watchdog_at: null,
    watchdog_alerted_at: null,
    ...over,
  };
}

describe("decideWatchdog", () => {
  it("restarts the real Autodesk stall", () => {
    expect(decideWatchdog(job(), NOW)).toEqual({ action: "restart", restarts: 1, mark: 4088 });
  });

  it("leaves a moving job alone, right up to the threshold", () => {
    expect(decideWatchdog(job({ updated_at: minsAgo(2) }), NOW).action).toBe("ok");
    expect(decideWatchdog(job({ updated_at: minsAgo(WATCHDOG_STALL_MINUTES - 1) }), NOW).action).toBe("ok");
    expect(decideWatchdog(job({ updated_at: minsAgo(WATCHDOG_STALL_MINUTES) }), NOW).action).toBe("restart");
  });

  it("ignores finished, failed and cancelled jobs however old", () => {
    for (const status of ["completed", "failed", "cancelled"]) {
      expect(decideWatchdog(job({ status }), NOW).action).toBe("ok");
    }
  });

  it("watches queued jobs too — a job that never started is the same stall", () => {
    expect(decideWatchdog(job({ status: "queued" }), NOW).action).toBe("restart");
  });

  it("gives a restart a full window before judging it", () => {
    // Restarted 10 min ago; mark-running bumped updated_at, no photos yet.
    const j = job({ watchdog_restarts: 1, watchdog_mark: 4088, watchdog_at: minsAgo(10), updated_at: minsAgo(10) });
    expect(decideWatchdog(j, NOW).action).toBe("ok");
  });

  it("does not mistake the mark-running timestamp bump for recovery", () => {
    // Restarted 40 min ago; updated_at moved at restart but no photo landed.
    const j = job({ watchdog_restarts: 1, watchdog_mark: 4088, watchdog_at: minsAgo(40), updated_at: minsAgo(39) });
    expect(decideWatchdog(j, NOW)).toEqual({ action: "restart", restarts: 2, mark: 4088 });
  });

  it("alerts once the restart budget is spent, then hands off", () => {
    const spent = job({ watchdog_restarts: WATCHDOG_MAX_RESTARTS, watchdog_mark: 4088, watchdog_at: minsAgo(45) });
    const verdict = decideWatchdog(spent, NOW);
    expect(verdict.action).toBe("alert");
    const alerted = { ...spent, watchdog_alerted_at: minsAgo(15) };
    expect(decideWatchdog(alerted, NOW).action).toBe("handed-off");
  });

  it("resets the budget when photos landed after the last intervention", () => {
    // Two restarts and an alert, then it moved (4,088 → 5,200), then stalled again.
    const j = job({
      images_done: 5200,
      updated_at: minsAgo(35),
      watchdog_restarts: WATCHDOG_MAX_RESTARTS,
      watchdog_mark: 4088,
      watchdog_at: minsAgo(120),
      watchdog_alerted_at: minsAgo(90),
    });
    expect(decideWatchdog(j, NOW)).toEqual({ action: "restart", restarts: 1, mark: 5200 });
  });

  it("does not read a restart's re-walk as recovery (skips and failures are not progress)", () => {
    // Restarted at 4,388; the resumed run re-skipped 388 already-landed photos
    // on the half-drained page. images_done did not move: still stuck.
    const j = { ...job({ images_done: 4388, updated_at: minsAgo(35), watchdog_restarts: 2, watchdog_mark: 4388, watchdog_at: minsAgo(60) }), images_skipped: 388 };
    expect(decideWatchdog(j, NOW).action).toBe("alert");
  });

  it("treats an unparseable timestamp as not-stalled rather than restarting blind", () => {
    expect(decideWatchdog(job({ updated_at: "garbage" }), NOW).action).toBe("ok");
  });

  it("does not let a bad watchdog_at hide a real stall", () => {
    expect(decideWatchdog(job({ watchdog_at: "garbage" }), NOW).action).toBe("restart");
  });
});
