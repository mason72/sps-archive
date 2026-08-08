import { describe, it, expect } from "vitest";
import {
  waitForQueueRoom,
  PRESIGN_QUEUE_HIGH_WATER,
  PRESIGN_WAIT_POLL_MS,
} from "./backpressure";

/** Resolves immediately but still yields, so "sleeps" are countable and fast. */
function fakeSleep() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    fn: async () => {
      calls++;
    },
  };
}

describe("waitForQueueRoom", () => {
  it("returns immediately when the queue has room", async () => {
    const sleep = fakeSleep();
    await waitForQueueRoom(() => 0, () => false, { sleep: sleep.fn });
    expect(sleep.calls).toBe(0);
  });

  it("waits while the queue is at the high-water mark, then proceeds as it drains", async () => {
    let depth = PRESIGN_QUEUE_HIGH_WATER + 10;
    const sleep = {
      calls: 0,
      fn: async () => {
        sleep.calls++;
        depth -= 5; // a worker finished
      },
    };
    await waitForQueueRoom(() => depth, () => false, { sleep: sleep.fn });
    expect(sleep.calls).toBeGreaterThan(0);
    expect(depth).toBeLessThan(PRESIGN_QUEUE_HIGH_WATER);
  });

  it("is bounded by the mark, not by the size of the drop — the HDC regression", async () => {
    // Producer mints chunks of 50; consumer drains 12 at a time. Without
    // backpressure the queue reaches the full 3,839-file drop. Assert the depth
    // never exceeds one chunk beyond the mark, however large the drop.
    const CHUNK = 50;
    const DROP = 3839;
    let queue = 0;
    let minted = 0;
    let peak = 0;
    const sleep = async () => {
      queue = Math.max(0, queue - 12); // workers drain
    };

    while (minted < DROP) {
      await waitForQueueRoom(() => queue, () => false, { sleep });
      const n = Math.min(CHUNK, DROP - minted);
      queue += n;
      minted += n;
      peak = Math.max(peak, queue);
    }

    expect(minted).toBe(DROP);
    expect(peak).toBeLessThanOrEqual(PRESIGN_QUEUE_HIGH_WATER + CHUNK);
    // The property that matters: exposure is a constant, not a function of drop size.
    expect(peak).toBeLessThan(DROP / 10);
  });

  it("the same producer WITHOUT the wait reproduces the incident — the assertion has teeth", async () => {
    // Identical loop, minus waitForQueueRoom. If this ever stops blowing the
    // bound, the test above has gone slack and is no longer proving anything.
    const CHUNK = 50;
    const DROP = 3839;
    let queue = 0;
    let minted = 0;
    let peak = 0;
    while (minted < DROP) {
      const n = Math.min(CHUNK, DROP - minted);
      queue += n;
      minted += n;
      peak = Math.max(peak, queue);
      queue = Math.max(0, queue - 12); // workers drain, but never fast enough
    }
    expect(peak).toBeGreaterThan(PRESIGN_QUEUE_HIGH_WATER + CHUNK);
    expect(peak).toBeGreaterThan(DROP / 10);
  });

  it("stops waiting when the session aborts, so cancel is never blocked", async () => {
    let aborted = false;
    const sleep = {
      calls: 0,
      fn: async () => {
        sleep.calls++;
        if (sleep.calls === 3) aborted = true;
      },
    };
    // Queue stays jammed above the mark forever; only the abort can end this.
    await waitForQueueRoom(() => 999, () => aborted, { sleep: sleep.fn });
    expect(sleep.calls).toBe(3);
  });

  it("keeps the mark above the worker pool so presign never starves the workers", () => {
    // 12 = MAX_CONCURRENT_UPLOADS in UploadZone. If the mark ever drops to or
    // below it, workers idle waiting on presign round-trips.
    expect(PRESIGN_QUEUE_HIGH_WATER).toBeGreaterThan(12);
    expect(PRESIGN_WAIT_POLL_MS).toBeGreaterThan(0);
  });
});
