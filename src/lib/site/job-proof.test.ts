import { describe, it, expect } from "vitest";
import { computeJobProof, heartbeatDays, JobProofError, MIN_DAY_PHOTOS } from "./job-proof";

const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-09T14:00:00Z");
/** n frames spread evenly over `hours` starting at `start`. */
const frames = (start: number, hours: number, n: number) =>
  Array.from({ length: n }, (_, i) => start + Math.floor((i * hours * H) / n));

describe("heartbeatDays", () => {
  it("splits days on a 4-hour gap and bins hours from each day's first frame", () => {
    const day1 = frames(T0, 3, 30); // 10 per hour for 3 hours
    const day2 = frames(T0 + 24 * H, 2, 20);
    expect(heartbeatDays([...day2, ...day1])).toEqual([
      [10, 10, 10],
      [10, 10],
    ]);
  });

  it("does not split on a long lunch under 4 hours", () => {
    // last morning frame at 0:57, first afternoon frame at 3:00: a 2-hour gap
    const days = heartbeatDays([...frames(T0, 1, 20), ...frames(T0 + 3 * H, 1, 20)]);
    expect(days).toHaveLength(1);
    expect(days![0]).toEqual([20, 0, 0, 20]);
  });

  it("is clock-free: the same day shifted by nine timezone hours reads identically", () => {
    const day = frames(T0, 5, 50);
    expect(heartbeatDays(day.map((t) => t + 9 * H))).toEqual(heartbeatDays(day));
  });

  it("drops stray runs (a test frame the night before)", () => {
    const stray = frames(T0 - 12 * H, 0.1, MIN_DAY_PHOTOS - 1);
    expect(heartbeatDays([...stray, ...frames(T0, 2, 20)])).toEqual([[10, 10]]);
  });

  it("returns null with nothing usable", () => {
    expect(heartbeatDays([])).toBeNull();
    expect(heartbeatDays([NaN, T0])).toBeNull();
  });

  it("caps a day at 24 hours", () => {
    // frames every 2 hours for 30 hours: no 4h gap, one long run
    const run = Array.from({ length: 16 }, (_, i) => T0 + i * 2 * H);
    const days = heartbeatDays(run)!;
    expect(days[0].length).toBeLessThanOrEqual(24);
  });
});

/* A minimal stand-in for the Supabase query builder: each table answers with
   canned results. Enough to exercise ownership and the count failure paths. */
function fakeDb(answers: {
  events: { data: { id: string }[] | null; error: { message: string } | null };
  images?: { id: string; taken_at: string | null }[];
  persons?: { count: number | null; error: { message: string } | null; status: number };
}) {
  const calls: Array<{ table: string; filters: unknown[] }> = [];
  const builder = (table: string) => {
    const filters: unknown[] = [];
    calls.push({ table, filters });
    const b: Record<string, unknown> = {
      select: () => b,
      in: (col: string, v: unknown) => (filters.push(["in", col, v]), b),
      eq: (col: string, v: unknown) => (filters.push(["eq", col, v]), b),
      order: () => b,
      range: (from: number, to: number) =>
        Promise.resolve({ data: (answers.images ?? []).slice(from, to + 1), error: null }),
      then: (resolve: (v: unknown) => void) =>
        resolve(table === "events" ? answers.events : answers.persons),
    };
    return b;
  };
  return { db: { from: builder } as never, calls };
}

const A = "87a045a5-9d25-490e-a307-61bf8d63d122";
const B = "f37a9cfa-4b0f-43b4-bd3d-ee7312247772";

describe("computeJobProof", () => {
  it("returns null with no sources, without touching the database", async () => {
    const { db, calls } = fakeDb({ events: { data: [], error: null } });
    expect(await computeJobProof(db, "user", [])).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("scopes the ownership read to the user, and refuses a gallery it does not own", async () => {
    const { db, calls } = fakeDb({ events: { data: [{ id: A }], error: null } });
    await expect(
      computeJobProof(db, "user-1", [{ eventId: A, people: false }, { eventId: B, people: false }])
    ).rejects.toBeInstanceOf(JobProofError);
    expect(calls[0].filters).toContainEqual(["eq", "user_id", "user-1"]);
  });

  it("counts photos, galleries and only the marked galleries' people", async () => {
    const images: { id: string; taken_at: string | null }[] = frames(T0, 2, 20).map((t, i) => ({
      id: `i${i}`,
      taken_at: new Date(t).toISOString(),
    }));
    images.push({ id: "no-clock", taken_at: null });
    const { db, calls } = fakeDb({
      events: { data: [{ id: A }, { id: B }], error: null },
      images,
      persons: { count: 502, error: null, status: 200 },
    });
    const proof = await computeJobProof(
      db,
      "user-1",
      [{ eventId: A, people: true }, { eventId: B, people: false }],
      new Date("2026-11-23T00:00:00Z")
    );
    expect(proof).toEqual({
      photos: 21, // the frame without a clock still counts as delivered
      galleries: 2,
      people: 502,
      days: [[10, 10]],
      countedAt: "2026-11-23T00:00:00.000Z",
    });
    // a gallery's uploaded cover (the client's logo) is not a photo
    expect(calls.find((c) => c.table === "images")!.filters).toContainEqual(["eq", "is_cover_upload", false]);
    const personsCall = calls.find((c) => c.table === "persons")!;
    expect(personsCall.filters).toContainEqual(["in", "event_id", [A]]);
  });

  it("refuses the TDP Work and Website galleries as sources", async () => {
    for (const slug of ["tdp-work", "tdp-website"]) {
      const { db } = fakeDb({ events: { data: [{ id: A, slug } as { id: string }], error: null } });
      await expect(computeJobProof(db, "u", [{ eventId: A, people: false }])).rejects.toBeInstanceOf(JobProofError);
    }
  });

  it("people is null when no gallery is marked", async () => {
    const { db } = fakeDb({ events: { data: [{ id: A }], error: null }, images: [] });
    const proof = await computeJobProof(db, "u", [{ eventId: A, people: false }]);
    expect(proof?.people).toBeNull();
  });

  it("a failed or bodiless people count throws instead of reading as 0", async () => {
    for (const persons of [
      { count: null, error: { message: "" }, status: 400 },
      { count: null, error: null, status: 404 },
    ]) {
      const { db } = fakeDb({ events: { data: [{ id: A }], error: null }, images: [], persons });
      await expect(computeJobProof(db, "u", [{ eventId: A, people: true }])).rejects.toThrow(/People count failed: HTTP/);
    }
  });
});
