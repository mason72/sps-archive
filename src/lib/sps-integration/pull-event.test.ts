import { describe, it, expect, vi } from "vitest";
import {
  isPageDrained,
  IMPORT_SLICE,
  createProgressFlusher,
  applySliceResult,
} from "./pull-event";
import { MANIFEST_PAGE_SIZE } from "./pull-client";

/**
 * The slice walk decides when to advance to the next manifest page. Its failure
 * mode is silent: an off-by-one leaves the tail of every page unimported with no
 * error anywhere, which is exactly the class of bug that costs a photographer
 * frames they think are archived.
 */
describe("isPageDrained", () => {
  it("drains a full SPS page in exactly the expected number of slices", () => {
    const slices = MANIFEST_PAGE_SIZE / IMPORT_SLICE;
    for (let i = 0; i < slices - 1; i++) {
      expect(isPageDrained(i, MANIFEST_PAGE_SIZE)).toBe(false);
    }
    expect(isPageDrained(slices - 1, MANIFEST_PAGE_SIZE)).toBe(true);
  });

  it("treats an empty page as drained by its first slice", () => {
    // Every image on the page was deselected in review — there is nothing to do
    // and the walk must still move on rather than spin.
    expect(isPageDrained(0, 0)).toBe(true);
  });

  it("drains a short page in one slice", () => {
    expect(isPageDrained(0, 1)).toBe(true);
    expect(isPageDrained(0, IMPORT_SLICE - 1)).toBe(true);
    expect(isPageDrained(0, IMPORT_SLICE)).toBe(true);
  });

  it("does NOT drain a page one image longer than a slice", () => {
    // The off-by-one that would silently drop that one image.
    expect(isPageDrained(0, IMPORT_SLICE + 1)).toBe(false);
    expect(isPageDrained(1, IMPORT_SLICE + 1)).toBe(true);
  });

  it("covers every image for every page size up to a full page", () => {
    // Property check: walking slices until drained must visit at least pageSize
    // images, for every possible page size. This is the assertion that would
    // have caught a `>` instead of `>=`.
    for (let pageSize = 0; pageSize <= MANIFEST_PAGE_SIZE; pageSize++) {
      let sliceIndex = 0;
      while (!isPageDrained(sliceIndex, pageSize)) {
        sliceIndex++;
        if (sliceIndex > 1000) throw new Error(`never drained at ${pageSize}`);
      }
      const covered = (sliceIndex + 1) * IMPORT_SLICE;
      expect(covered).toBeGreaterThanOrEqual(pageSize);
    }
  });
});

/**
 * Lesson 161: six workers flush progress concurrently. The flusher must never
 * send the same photos twice, never drop photos when a write fails, and must
 * pass the job row's increment the right arguments. The DB half (that the
 * increment is atomic under real concurrency) is proven against production by
 * scripts/triage/sps-pull-progress-race.ts, which races the old fold as a
 * control.
 */
describe("createProgressFlusher", () => {
  const zero = { imported: 0, failed: 0, skipped: 0, bytes: 0 };
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 5));

  it("sends every photo exactly once when flushes overlap", async () => {
    const row = { ...zero };
    const flusher = createProgressFlusher(async (d) => {
      await tick(); // the write is in flight while other workers flush
      row.imported += d.imported;
      row.bytes += d.bytes;
    });

    const totals = { ...zero };
    await Promise.all(
      Array.from({ length: 6 }, async () => {
        for (let i = 0; i < 50; i++) {
          await tick();
          totals.imported++;
          totals.bytes += 1000;
          if (totals.imported % 5 === 0) await flusher.flush(totals);
        }
      })
    );
    await flusher.flush(totals); // the slice-end remainder

    expect(row).toEqual({ ...zero, imported: 300, bytes: 300_000 });
  });

  it("hands a failed write's delta back to the next flush", async () => {
    const row = { ...zero };
    let fail = true;
    const flusher = createProgressFlusher(async (d) => {
      if (fail) throw new Error("transient PostgREST error");
      row.imported += d.imported;
      row.failed += d.failed;
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    await flusher.flush({ ...zero, imported: 5 });
    expect(row.imported).toBe(0);

    fail = false;
    await flusher.flush({ ...zero, imported: 10, failed: 1 });
    expect(row).toEqual({ ...zero, imported: 10, failed: 1 });
    expect(err).toHaveBeenCalledOnce();
    err.mockRestore();
  });

  it("gives back only its own delta when another flush claimed more meanwhile", async () => {
    const row = { ...zero };
    let calls = 0;
    const flusher = createProgressFlusher(async (d) => {
      const n = ++calls;
      await tick();
      if (n === 1) throw new Error("first write fails");
      row.imported += d.imported;
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    const first = flusher.flush({ ...zero, imported: 5 }); // claims 5, will fail
    await flusher.flush({ ...zero, imported: 10 }); // claims the newer 5, lands
    await first;
    await flusher.flush({ ...zero, imported: 10 }); // re-sends the failed 5

    expect(row.imported).toBe(10);
    err.mockRestore();
  });

  it("skips a flush with nothing new", async () => {
    const write = vi.fn(async () => {});
    const flusher = createProgressFlusher(write);
    await flusher.flush({ ...zero });
    await flusher.flush({ ...zero, imported: 5 });
    await flusher.flush({ ...zero, imported: 5 });
    expect(write).toHaveBeenCalledOnce();
  });
});

describe("applySliceResult", () => {
  const slice = {
    imported: 5, failed: 1, skipped: 2, bytes: 4096, confirmed: 3,
    pageSize: 100, nextOffset: 500,
  };
  const client = (result: { data: unknown; error: unknown }) => {
    const rpc = vi.fn(async () => result);
    return { rpc, db: { rpc } as unknown as Parameters<typeof applySliceResult>[0] };
  };

  it("folds with ONE atomic increment, and leaves the offset alone unless given", async () => {
    const { rpc, db } = client({ data: true, error: null });
    await applySliceResult(db, "job-1", slice, null);
    expect(rpc).toHaveBeenCalledWith("sps_pull_add_progress", {
      p_job_id: "job-1", p_done: 5, p_failed: 1, p_skipped: 2,
      p_bytes: 4096, p_confirmed: 3,
    });
  });

  it("passes the offset only when a page drained", async () => {
    const { rpc, db } = client({ data: true, error: null });
    await applySliceResult(db, "job-1", slice, 500);
    expect(rpc.mock.calls[0]).toEqual([
      "sps_pull_add_progress",
      expect.objectContaining({ p_next_offset: 500 }),
    ]);
  });

  it("throws when the job row is gone or the call errors", async () => {
    await expect(
      applySliceResult(client({ data: null, error: null }).db, "job-1", slice, null)
    ).rejects.toThrow(/vanished/);
    await expect(
      applySliceResult(client({ data: null, error: new Error("boom") }).db, "job-1", slice, null)
    ).rejects.toThrow("boom");
  });
});
