import { describe, expect, it, vi } from "vitest";

/**
 * The 2026-08-16 upload wedge, as a test.
 *
 * UploadManager's `updateFile` used to call `setBatches` on every XHR progress
 * event. XHR fires those roughly every 50ms per request, so 12 concurrent
 * workers produced ~240 state writes a second — and each write rebuilt the
 * WHOLE structure, allocating a new object per file across every batch. Cost
 * per tick was O(total files staged).
 *
 * Mason dropped 1,197 photos rapid-fire from several folders: ~36 concurrent
 * batches, ~2,600 files in state. The main thread livelocked. Uploads crawled,
 * the Enter key stopped rendering, and the server logs stayed perfectly clean
 * because nothing was actually wrong on the server.
 *
 * This test pins the property that fixes it: the number of state writes must
 * track FLUSHES, not ticks, and one flush must cost one pass no matter how many
 * files changed inside the window. It reimplements the coalescing shape rather
 * than importing the component, because the real thing is closure state inside
 * a React provider — the invariant under test is the algorithm, not the JSX.
 */

interface FileRow {
  id: string;
  status: string;
  progress: number;
}
interface BatchRow {
  id: string;
  files: FileRow[];
}

/** The coalescing buffer, exactly as UploadManager applies it. */
function makeCoalescer(
  setBatches: (fn: (prev: BatchRow[]) => BatchRow[]) => void
) {
  let pending = new Map<string, Map<string, Partial<FileRow>>>();
  let armed = false;

  const flush = () => {
    armed = false;
    if (pending.size === 0) return;
    const batchPatches = pending;
    pending = new Map();
    setBatches((prev) =>
      prev.map((b) => {
        const forBatch = batchPatches.get(b.id);
        if (!forBatch) return b;
        return {
          ...b,
          files: b.files.map((f) => {
            const patch = forBatch.get(f.id);
            return patch ? { ...f, ...patch } : f;
          }),
        };
      })
    );
  };

  const updateFile = (
    batchId: string,
    fileId: string,
    patch: Partial<FileRow>
  ) => {
    let forBatch = pending.get(batchId);
    if (!forBatch) {
      forBatch = new Map();
      pending.set(batchId, forBatch);
    }
    forBatch.set(fileId, { ...(forBatch.get(fileId) ?? {}), ...patch });
    if (!armed) {
      armed = true;
      setTimeout(flush, 100);
    }
  };

  return { updateFile, flush };
}

function stage(batchCount: number, filesPerBatch: number): BatchRow[] {
  return Array.from({ length: batchCount }, (_, b) => ({
    id: `b${b}`,
    files: Array.from({ length: filesPerBatch }, (_, f) => ({
      id: `b${b}-f${f}`,
      status: "pending",
      progress: 0,
    })),
  }));
}

describe("upload progress patch coalescing", () => {
  it("collapses a burst of progress ticks into ONE state write", () => {
    vi.useFakeTimers();
    let state = stage(36, 72); // ~2,592 files — the shape of Mason's drop
    let writes = 0;
    const setBatches = (fn: (prev: BatchRow[]) => BatchRow[]) => {
      writes++;
      state = fn(state);
    };
    const { updateFile } = makeCoalescer(setBatches);

    // 12 workers, each reporting 1% → 100% within one flush window.
    for (let worker = 0; worker < 12; worker++) {
      for (let pct = 1; pct <= 100; pct++) {
        updateFile(`b${worker}`, `b${worker}-f0`, { progress: pct });
      }
    }

    // 1,200 ticks, and not one has touched React state yet.
    expect(writes).toBe(0);

    vi.advanceTimersByTime(100);

    // The whole burst cost a single pass. Unbatched this was 1,200 writes,
    // each re-allocating ~2,592 objects — 3.1 million allocations for one
    // window, which is the livelock in one number.
    expect(writes).toBe(1);
    // Last value wins, so the bar still lands on the truth.
    expect(state[0].files[0].progress).toBe(100);
    expect(state[11].files[0].progress).toBe(100);
    vi.useRealTimers();
  });

  it("merges rather than replaces, so a status set mid-window survives", () => {
    vi.useFakeTimers();
    let state = stage(1, 3);
    const setBatches = (fn: (prev: BatchRow[]) => BatchRow[]) => {
      state = fn(state);
    };
    const { updateFile } = makeCoalescer(setBatches);

    updateFile("b0", "b0-f1", { status: "uploading" });
    updateFile("b0", "b0-f1", { progress: 40 });
    updateFile("b0", "b0-f1", { progress: 90 });
    vi.advanceTimersByTime(100);

    // A naive `set(fileId, patch)` would have dropped "uploading" — the file
    // would read pending at 90%, and cancelBatch drops pending files.
    expect(state[0].files[1]).toMatchObject({
      status: "uploading",
      progress: 90,
    });
    vi.useRealTimers();
  });

  it("leaves untouched batches referentially identical", () => {
    vi.useFakeTimers();
    let state = stage(4, 5);
    const before = state;
    const setBatches = (fn: (prev: BatchRow[]) => BatchRow[]) => {
      state = fn(state);
    };
    const { updateFile } = makeCoalescer(setBatches);

    updateFile("b2", "b2-f3", { progress: 55 });
    vi.advanceTimersByTime(100);

    // Only the touched batch is rebuilt, so React skips re-rendering the rest.
    // This is what keeps the cost of one flush proportional to what CHANGED
    // rather than to everything staged.
    expect(state[0]).toBe(before[0]);
    expect(state[1]).toBe(before[1]);
    expect(state[3]).toBe(before[3]);
    expect(state[2]).not.toBe(before[2]);
    expect(state[2].files[3].progress).toBe(55);
    vi.useRealTimers();
  });

  it("re-arms after a flush so later ticks are not lost", () => {
    vi.useFakeTimers();
    let state = stage(1, 2);
    let writes = 0;
    const setBatches = (fn: (prev: BatchRow[]) => BatchRow[]) => {
      writes++;
      state = fn(state);
    };
    const { updateFile } = makeCoalescer(setBatches);

    updateFile("b0", "b0-f0", { progress: 10 });
    vi.advanceTimersByTime(100);
    updateFile("b0", "b0-f0", { progress: 20 });
    vi.advanceTimersByTime(100);
    updateFile("b0", "b0-f0", { status: "complete", progress: 100 });
    vi.advanceTimersByTime(100);

    expect(writes).toBe(3);
    expect(state[0].files[0]).toMatchObject({ status: "complete", progress: 100 });
    vi.useRealTimers();
  });
});
