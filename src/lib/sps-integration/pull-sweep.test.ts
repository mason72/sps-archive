import { describe, it, expect, vi, beforeEach } from "vitest";

// Only `sweepPage` (bottom of this file) touches these. Everything above it is
// pure and never reaches a mock.
vi.mock("./connection", () => ({ getSpsToken: vi.fn(async () => "token") }));
vi.mock("./pull-client", async (original) => ({
  ...(await original<typeof import("./pull-client")>()),
  fetchManifestPage: vi.fn(),
}));
vi.mock("./pull-placement", () => ({ planSweepPlacement: vi.fn() }));
vi.mock("./pull-event", async (original) => ({
  ...(await original<typeof import("./pull-event")>()),
  importBatch: vi.fn(async () => ({ durable: [], failures: [] })),
  applySliceResult: vi.fn(async () => {}),
  confirmDurable: vi.fn(async () => {}),
  intakeAppendPoint: vi.fn(),
}));

import {
  GONE_REASON,
  planSweep,
  planSweepPage,
  readFailureLog,
  readMissing,
  retryableMissing,
  sweepCandidates,
  sweepPage,
  unresolvedEntries,
} from "./pull-sweep";
import { fetchManifestPage, type SpsManifestImage } from "./pull-client";
import { importBatch, intakeAppendPoint, type SpsPullJob } from "./pull-event";
import { planSweepPlacement } from "./pull-placement";

const img = (id: string): SpsManifestImage => ({
  id,
  originalFilename: `${id}.jpg`,
  width: null,
  height: null,
  mimeType: "image/jpeg",
  capturedAt: null,
  boothId: null,
  quality: "archive",
  alreadyPulled: false,
  url: `https://sps.example/${id}`,
});

/**
 * The sweep decides what a finished import goes back for. Both of its failure
 * modes are quiet: too narrow and a photo stays lost behind a job that reads
 * "completed"; too wide and it re-imports photos a person deliberately removed
 * from a delivered gallery.
 */
describe("sweepCandidates", () => {
  const page = [img("a"), img("b"), img("c"), img("d")];

  it("takes everything the review kept when nothing narrows it (the audit)", () => {
    expect(sweepCandidates(page, ["b"], null).map((i) => i.id)).toEqual(["a", "c", "d"]);
  });

  it("is confined to the watched ids in a sweep", () => {
    // The whole reason the sweep is narrowed: `d` is absent from the gallery
    // because a person removed it, and it must not even be looked at.
    expect(sweepCandidates(page, [], new Set(["a", "c"])).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("never brings back a deselected photo, even if the stored list names it", () => {
    expect(sweepCandidates(page, ["a"], new Set(["a", "c"])).map((i) => i.id)).toEqual(["c"]);
  });

  it("an EMPTY watch list selects nothing (it is not 'no restriction')", () => {
    expect(sweepCandidates(page, [], new Set())).toEqual([]);
  });
});

describe("planSweepPage", () => {
  const candidates = ["a", "b", "c", "d", "e"].map(img);

  it("attempts what has no row, and only that", () => {
    const plan = planSweepPage({
      candidates,
      present: new Set(["a", "c", "e"]),
      fetch: null,
      skip: new Set(),
      limit: 100,
    });
    expect(plan.absent.map((i) => i.id)).toEqual(["b", "d"]);
    expect(plan.batch.map((i) => i.id)).toEqual(["b", "d"]);
    expect(plan.more).toBe(false);
  });

  it("gives a failed photo one more try, not a loop", () => {
    // `b` failed earlier in this run. It is still absent (so it stays reported)
    // and it is not attempted again.
    const plan = planSweepPage({
      candidates,
      present: new Set(["a", "c", "e"]),
      fetch: null,
      skip: new Set(["b"]),
      limit: 100,
    });
    expect(plan.absent.map((i) => i.id)).toEqual(["b", "d"]);
    expect(plan.batch.map((i) => i.id)).toEqual(["d"]);
  });

  it("caps a step and asks to come back to the page", () => {
    const plan = planSweepPage({ candidates, present: new Set(), fetch: null, skip: new Set(), limit: 2 });
    expect(plan.batch.map((i) => i.id)).toEqual(["a", "b"]);
    expect(plan.more).toBe(true);
  });

  it("terminates: the second visit sees the first batch as present or skipped", () => {
    // Pass 1 imported `a` and failed `b`. Pass 2 must make progress on c, d, e
    // rather than hand back the same two forever.
    const second = planSweepPage({
      candidates,
      present: new Set(["a"]),
      fetch: null,
      skip: new Set(["b"]),
      limit: 2,
    });
    expect(second.batch.map((i) => i.id)).toEqual(["c", "d"]);
    expect(second.more).toBe(true);
    const third = planSweepPage({
      candidates,
      present: new Set(["a", "c", "d"]),
      fetch: null,
      skip: new Set(["b"]),
      limit: 2,
    });
    expect(third.batch.map((i) => i.id)).toEqual(["e"]);
    expect(third.more).toBe(false);
  });

  it("a page with nothing absent has nothing to do", () => {
    const plan = planSweepPage({
      candidates,
      present: new Set(["a", "b", "c", "d", "e"]),
      fetch: null,
      skip: new Set(),
      limit: 100,
    });
    expect(plan.batch).toEqual([]);
    expect(plan.more).toBe(false);
  });
});

describe("readMissing", () => {
  it("keeps 'never checked' apart from 'checked, nothing missing'", () => {
    expect(readMissing(null)).toBeNull();
    expect(readMissing(undefined)).toBeNull();
    expect(readMissing([])).toEqual([]);
  });

  it("reads entries and drops anything without an id", () => {
    expect(
      readMissing([
        { spsImageId: "a", filename: "a.jpg", reason: "timeout" },
        { filename: "no-id.jpg" },
        "junk",
        { spsImageId: "b", gone: true },
      ])
    ).toEqual([
      { spsImageId: "a", filename: "a.jpg", reason: "timeout" },
      { spsImageId: "b", filename: "b", reason: "", gone: true },
    ]);
  });

  it("a non-array is 'never checked', not a crash", () => {
    expect(readMissing({ spsImageId: "a" })).toBeNull();
  });
});

describe("planSweepPage with a nomination", () => {
  it("never fetches a watched photo that was not nominated", () => {
    // `b` and `d` are both absent. Only `b` is on the stored list. `d` is in
    // the failure log (so it is watched), landed at the time, and was removed
    // by a person since: it stays removed.
    const plan = planSweepPage({
      candidates: ["a", "b", "d"].map(img),
      present: new Set(["a"]),
      fetch: new Set(["b"]),
      skip: new Set(),
      limit: 100,
    });
    expect(plan.batch.map((i) => i.id)).toEqual(["b"]);
  });
});

describe("planSweep", () => {
  const log = [
    { spsImageId: "a", filename: "a.jpg", reason: "[object Object]" },
    { spsImageId: "b", filename: "b.jpg", reason: "[object Object]" },
    // The same photo failing again on a retried step is one nominee.
    { spsImageId: "a", filename: "a.jpg", reason: "[object Object]" },
  ];

  it("a first run fetches what the walk failed on", () => {
    const plan = planSweep({ missing: null, failures: log });
    expect(plan.fetch.map((m) => m.spsImageId)).toEqual(["a", "b"]);
    expect(plan.watch.sort()).toEqual(["a", "b"]);
    expect(plan.carried).toEqual([]);
  });

  it("a clean import nominates nothing, so the sweep reads no page", () => {
    const plan = planSweep({ missing: null, failures: [] });
    expect(plan.fetch).toEqual([]);
    expect(plan.watch).toEqual([]);
  });

  it("a retry fetches the STORED list, and only watches the rest of the log", () => {
    // AAOMS: nine logged, five stored as missing. The other four are looked at
    // (to report them to SPS) and never fetched.
    const plan = planSweep({
      missing: [{ spsImageId: "b", filename: "b.jpg", reason: "Failed during the import" }],
      failures: log,
    });
    expect(plan.fetch.map((m) => m.spsImageId)).toEqual(["b"]);
    expect(plan.watch.sort()).toEqual(["a", "b"]);
  });

  it("an empty stored list is a list: nothing is fetched, even with a log", () => {
    // "Checked, nothing missing" must not fall back to the log, or a retried
    // step on a finished job would re-fetch photos a person removed since.
    const plan = planSweep({ missing: [], failures: log });
    expect(plan.fetch).toEqual([]);
  });

  it("carries what is already known to be gone, and does not fetch it", () => {
    const gone = { spsImageId: "c", filename: "c.jpg", reason: GONE_REASON, gone: true };
    const plan = planSweep({
      missing: [gone, { spsImageId: "b", filename: "b.jpg", reason: "timeout" }],
      failures: [],
    });
    expect(plan.fetch.map((m) => m.spsImageId)).toEqual(["b"]);
    expect(plan.carried).toEqual([gone]);
    expect(retryableMissing([gone])).toEqual([]);
    expect(retryableMissing(null)).toEqual([]);
  });
});

describe("readFailureLog", () => {
  it("tolerates anything the column might hold", () => {
    expect(readFailureLog(null)).toEqual([]);
    expect(readFailureLog({})).toEqual([]);
    expect(readFailureLog([null, "x", { filename: "no-id.jpg" }, { spsImageId: "a" }])).toEqual([
      { spsImageId: "a", filename: "a" },
    ]);
  });
});

describe("unresolvedEntries", () => {
  const fetch = [
    { spsImageId: "a", filename: "a.jpg", reason: "timeout" },
    { spsImageId: "b", filename: "b.jpg", reason: "timeout" },
  ];

  it("a photo the whole manifest never showed is gone, and not retryable", () => {
    const out = unresolvedEntries(fetch, new Set(["b"]), null);
    expect(out).toEqual([{ spsImageId: "b", filename: "b.jpg", reason: GONE_REASON, gone: true }]);
    expect(retryableMissing(out)).toEqual([]);
  });

  it("a sweep that could not run leaves its photos OWED, never 'gone'", () => {
    // SPS unreachable is not "SPS no longer lists it". Marking these gone would
    // take the Retry button away from photos that are still there.
    const out = unresolvedEntries(fetch, new Set(["a", "b"]), "Could not reach SPS: timeout");
    expect(out.map((m) => m.gone)).toEqual([undefined, undefined]);
    expect(out[0].reason).toContain("Could not reach SPS");
    expect(retryableMissing(out)).toHaveLength(2);
  });

  it("returns nothing when every nominee was dealt with", () => {
    expect(unresolvedEntries(fetch, new Set(), null)).toEqual([]);
  });
});

/**
 * The wire this file's module exists for, since 2026-10-04: a swept photo is
 * placed by `planSweepPlacement` (beside its person), not by the intake. The
 * rule itself is tested in pull-placement.test.ts; this proves the sweep uses
 * it, which nothing else would notice if it were undone.
 */
describe("sweepPage placement", () => {
  const job = {
    id: "job-1",
    user_id: "user-1",
    event_id: "event-1",
    sps_event_id: "sps-event-1",
    deselected: [],
  } as unknown as SpsPullJob;

  /** The event's rows for the ids asked about: `present` are here already. */
  const db = (present: string[]) => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      in: (_col: string, ids: string[]) =>
        Promise.resolve({
          data: ids
            .filter((id) => present.includes(id))
            .map((id) => ({
              sps_image_id: id,
              r2_key: `events/event-1/${id}.jpg`,
              processing_status: "complete",
              sps_pulled_at: "2026-10-04T00:00:00Z",
            })),
          error: null,
        }),
    };
    return { from: () => builder } as unknown as Parameters<typeof sweepPage>[0];
  };

  beforeEach(() => {
    vi.mocked(planSweepPlacement).mockReset();
    vi.mocked(importBatch).mockClear();
    vi.mocked(intakeAppendPoint).mockClear();
    vi.mocked(fetchManifestPage).mockResolvedValue({
      images: [img("a"), img("b")],
    } as unknown as Awaited<ReturnType<typeof fetchManifestPage>>);
  });

  it("places what it fetches through the placement plan, never the intake", async () => {
    const placer = vi.fn();
    vi.mocked(planSweepPlacement).mockResolvedValue(placer);
    const supabase = db(["a"]);

    await sweepPage(supabase, job, 0, { watch: ["a", "b"], fetch: ["b"], skip: [] });

    // Planned for exactly the photos about to be fetched, in this event.
    expect(planSweepPlacement).toHaveBeenCalledWith(supabase, "event-1", [
      expect.objectContaining({ id: "b" }),
    ]);
    expect(importBatch).toHaveBeenCalledWith(
      supabase,
      job,
      [expect.objectContaining({ id: "b" })],
      expect.objectContaining({ place: placer })
    );
    expect(intakeAppendPoint).not.toHaveBeenCalled();
  });

  it("with nothing to fetch, it looks nothing up and creates nothing", async () => {
    await sweepPage(db(["a", "b"]), job, 0, { watch: ["a", "b"], fetch: ["b"], skip: [] });
    expect(planSweepPlacement).not.toHaveBeenCalled();
    expect(importBatch).not.toHaveBeenCalled();
    expect(intakeAppendPoint).not.toHaveBeenCalled();
  });

  it("a placement lookup that fails moves no photo: the step throws", async () => {
    vi.mocked(planSweepPlacement).mockRejectedValue(new Error("statement timeout"));
    await expect(
      sweepPage(db([]), job, 0, { watch: ["b"], fetch: ["b"], skip: [] })
    ).rejects.toThrow("statement timeout");
    expect(importBatch).not.toHaveBeenCalled();
  });
});
