import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// importBatch moves real bytes. Its tests stub the three things that leave the
// process: R2, the sharp thumbnailer and the EXIF reader.
vi.mock("@/lib/r2/client", async (original) => ({
  ...(await original<typeof import("@/lib/r2/client")>()),
  uploadToR2: vi.fn(async () => {}),
  deleteFromR2: vi.fn(async () => {}),
}));
vi.mock("@/lib/thumbnails/generate", () => ({
  generateThumbnailsFromBuffer: vi.fn(async () => ({
    thumbBytes: 100,
    width: 4,
    height: 3,
    dominantColor: "#000000",
  })),
}));
vi.mock("@/lib/upload/parse-filename", async (original) => ({
  ...(await original<typeof import("@/lib/upload/parse-filename")>()),
  extractExif: vi.fn(async () => null),
}));

import { deleteFromR2, uploadToR2 } from "@/lib/r2/client";
import {
  isPageDrained,
  IMPORT_SLICE,
  PROGRESS_FLUSH_EVERY,
  createProgressFlusher,
  applySliceResult,
  importBatch,
  type SpsPullJob,
} from "./pull-event";
import { MANIFEST_PAGE_SIZE, type SpsManifestImage } from "./pull-client";

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

/**
 * The one worker loop under both the walk and the closing sweep, run against
 * a recording stand-in for the database with R2 and thumbnails stubbed. What
 * it has to get right: a photo is linked exactly where `place` said, `place`
 * is asked only for a photo whose bytes arrived, and one photo failing never
 * takes the batch with it.
 */
describe("importBatch", () => {
  beforeEach(() => {
    vi.mocked(uploadToR2).mockClear();
    vi.mocked(deleteFromR2).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  const BYTES = 4096;
  const job = { id: "job-1", event_id: "event-1" } as SpsPullJob;
  const photos = (n: number): SpsManifestImage[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `sps-${i}`,
      originalFilename: `Ann Lee_26-09-30_${i}.jpg`,
      width: null,
      height: null,
      mimeType: "image/jpeg",
      capturedAt: null,
      boothId: null,
      quality: "archive" as const,
      alreadyPulled: false,
      url: `https://sps.example/${i}`,
    }));

  const sourceUp = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(BYTES), { headers: { "content-type": "image/jpeg" } })
      )
    );
  const sourceDown = () => {
    const spy = vi.fn(async () => {
      throw new Error("source down");
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  };

  /** Accepts every write and remembers it. */
  function recordingDb() {
    const writes: { table: string; op: string; values?: Record<string, unknown> }[] = [];
    const from = (table: string) => {
      const builder = {
        insert: (values: Record<string, unknown>) => (writes.push({ table, op: "insert", values }), builder),
        update: (values: Record<string, unknown>) => (writes.push({ table, op: "update", values }), builder),
        delete: () => (writes.push({ table, op: "delete" }), builder),
        eq: () => builder,
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
      };
      return builder;
    };
    const inserted = (table: string) =>
      writes.filter((w) => w.table === table && w.op === "insert").map((w) => w.values!);
    return { db: { from } as unknown as Parameters<typeof importBatch>[0], inserted };
  }

  const zero = () => ({ imported: 0, failed: 0, skipped: 0, bytes: 0 });

  it("links each photo exactly where it was placed, and counts it", async () => {
    sourceUp();
    const { db, inserted } = recordingDb();
    const counters = zero();
    const out = await importBatch(db, job, photos(3), {
      place: (_img, index) => ({ sectionId: `section-${index}`, sortOrder: 40 + index }),
      counters,
      flush: async () => {},
    });

    expect(out.failures).toEqual([]);
    expect([...out.durable].sort()).toEqual(["sps-0", "sps-1", "sps-2"]);
    expect(counters).toEqual({ imported: 3, failed: 0, skipped: 0, bytes: 3 * BYTES });

    const rows = inserted("images");
    const links = inserted("section_images");
    expect(rows).toHaveLength(3);
    // Every row got a link (no orphans), into the section its own photo was given.
    for (let i = 0; i < 3; i++) {
      const row = rows.find((r) => r.sps_image_id === `sps-${i}`)!;
      expect(links).toContainEqual({
        section_id: `section-${i}`,
        image_id: row.id,
        sort_order: 40 + i,
      });
    }
    expect(links).toHaveLength(3);
  });

  it("never asks where a photo goes if its bytes did not arrive", async () => {
    // This is what stops a failed retry from creating an empty "Unsorted":
    // the sweep's placer finds or creates the intake when it is ASKED.
    sourceDown();
    const { db, inserted } = recordingDb();
    const counters = { ...zero(), skipped: 3 };
    const place = vi.fn(() => ({ sectionId: "intake", sortOrder: 0 }));
    const flush = vi.fn(async () => {});

    const out = await importBatch(db, job, photos(12), { place, counters, flush });

    expect(place).not.toHaveBeenCalled();
    expect(inserted("images")).toEqual([]);
    expect(out.durable).toEqual([]);
    expect(out.failures).toHaveLength(12);
    expect(out.failures[0]).toEqual({
      spsImageId: "sps-0",
      filename: "Ann Lee_26-09-30_0.jpg",
      reason: "source down",
    });
    // Added to what the caller already knew, not reset.
    expect(counters).toEqual({ imported: 0, failed: 12, skipped: 3, bytes: 0 });
    // Progress moves during the batch, and once more at the end.
    expect(flush).toHaveBeenCalledTimes(Math.floor(12 / PROGRESS_FLUSH_EVERY) + 1);
  });

  it("a photo that cannot be placed fails alone, with no row and no object left", async () => {
    sourceUp();
    const { db, inserted } = recordingDb();
    const counters = zero();
    const out = await importBatch(db, job, photos(3), {
      place: (img, index) => {
        if (index === 1) throw new Error("Intake lookup failed");
        return { sectionId: "ps", sortOrder: index };
      },
      counters,
      flush: async () => {},
    });

    expect(counters).toMatchObject({ imported: 2, failed: 1 });
    expect(out.failures).toEqual([
      { spsImageId: "sps-1", filename: "Ann Lee_26-09-30_1.jpg", reason: "Intake lookup failed" },
    ]);
    // Bytes land before the row: its object was written, then taken back, and
    // no row was ever made for it.
    expect(uploadToR2).toHaveBeenCalledTimes(3);
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(inserted("images").map((r) => r.sps_image_id).sort()).toEqual(["sps-0", "sps-2"]);
    expect(inserted("section_images")).toHaveLength(2);
  });

  it("an empty batch still flushes once", async () => {
    const flush = vi.fn(async () => {});
    const out = await importBatch(recordingDb().db, job, [], {
      place: () => ({ sectionId: "intake", sortOrder: 0 }),
      counters: zero(),
      flush,
    });
    expect(out).toEqual({ durable: [], failures: [] });
    expect(flush).toHaveBeenCalledOnce();
  });
});
