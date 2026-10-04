import { describe, it, expect } from "vitest";
import {
  RECOVERED_NAMES_SHOWN,
  groupRecovered,
  loadRecovered,
} from "./pull-recovered";
import { fakeDb, type FakeState } from "./testing/fake-db";

const sections = new Map(
  [
    { id: "hl", name: "Highlights", sortOrder: 0 },
    { id: "ik", name: "I–K", sortOrder: 3 },
    { id: "ps", name: "P–S", sortOrder: 5 },
    { id: "in", name: "Unsorted", sortOrder: 9 },
    // A second tab somebody also called "P–S".
    { id: "ps2", name: "P–S", sortOrder: 6 },
  ].map((s) => [s.id, s])
);
const row = (id: string, filename = `${id}.jpg`) => ({ id, filename });

/**
 * The line that tells a photographer where a retried photo went. Its wrong
 * answers are all plausible: a tab the photo is not in, a count that does not
 * add up, or "every photo is filed" over one that is in no section at all.
 */
describe("groupRecovered", () => {
  it("groups by section, in the gallery's own order, and the counts add up", () => {
    const out = groupRecovered(
      [row("a"), row("b"), row("c"), row("d"), row("e")],
      new Map([
        ["a", ["ps"]],
        ["b", ["ik"]],
        ["c", ["ps"]],
        ["d", ["ik"]],
        ["e", ["ps"]],
      ]),
      sections
    );
    expect(out.total).toBe(5);
    expect(out.groups.map((g) => [g.section, g.count])).toEqual([
      ["I–K", 2],
      ["P–S", 3],
    ]);
    expect(out.groups.reduce((n, g) => n + g.count, 0)).toBe(out.total);
  });

  it("a Highlights pick is a copy: the photo is filed where it lives", () => {
    const out = groupRecovered([row("a")], new Map([["a", ["hl", "ps"]]]), sections);
    expect(out.groups).toEqual([{ section: "P–S", count: 1, filenames: ["a.jpg"] }]);
  });

  it("only in Highlights: say Highlights, the one place it can be found", () => {
    const out = groupRecovered([row("a")], new Map([["a", ["hl"]]]), sections);
    expect(out.groups[0].section).toBe("Highlights");
  });

  it("a link into another event's section is not this gallery's", () => {
    const out = groupRecovered([row("a")], new Map([["a", ["ps", "website-section"]]]), sections);
    expect(out.groups[0].section).toBe("P–S");
  });

  it("a photo in two sections is named under both, once", () => {
    const out = groupRecovered([row("a")], new Map([["a", ["ps", "ik", "ps"]]]), sections);
    expect(out.groups).toEqual([{ section: "I–K and P–S", count: 1, filenames: ["a.jpg"] }]);
  });

  it("two sections with one name are still two groups", () => {
    const out = groupRecovered(
      [row("a"), row("b")],
      new Map([
        ["a", ["ps"]],
        ["b", ["ps2"]],
      ]),
      sections
    );
    expect(out.groups.map((g) => [g.section, g.count])).toEqual([
      ["P–S", 1],
      ["P–S", 1],
    ]);
  });

  it("a photo in NO section is its own group, last, never folded into another", () => {
    const out = groupRecovered(
      [row("a"), row("b")],
      new Map([["b", ["ps"]]]),
      sections
    );
    expect(out.groups.map((g) => g.section)).toEqual(["P–S", null]);
    expect(out.groups[1]).toEqual({ section: null, count: 1, filenames: ["a.jpg"] });
  });

  it("caps the names it sends, never the counts", () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`p${i}`, `Guest_${String(i).padStart(4, "0")}.jpg`));
    const links = new Map(rows.map((r, i) => [r.id, [i < 20 ? "ik" : "ps"]]));
    const out = groupRecovered(rows, links, sections);
    expect(out.total).toBe(30);
    expect(out.groups.map((g) => g.count)).toEqual([20, 10]);
    expect(out.groups[0].filenames).toHaveLength(RECOVERED_NAMES_SHOWN);
    // The first group used the allowance; the second still reports its count.
    expect(out.groups[1].filenames).toEqual([]);
    // Names read in frame order, not row order.
    expect(out.groups[0].filenames[0]).toBe("Guest_0000.jpg");
  });
});

describe("loadRecovered", () => {
  const EVENT = "event-1";
  const WALKED = "2026-10-03T20:20:44.207+00:00";
  const image = (id: string, created: string, extra: Record<string, unknown> = {}) => ({
    id,
    event_id: EVENT,
    sps_image_id: `sps-${id}`,
    original_filename: `${id}.jpg`,
    created_at: created,
    ...extra,
  });
  const failed = (...ids: string[]) =>
    ids.map((id) => ({ spsImageId: `sps-${id}`, filename: `${id}.jpg`, reason: "timeout" }));

  function gallery(): FakeState {
    return {
      sections: [
        { id: "ik", event_id: EVENT, name: "I–K", sort_order: 3 },
        { id: "ps", event_id: EVENT, name: "P–S", sort_order: 5 },
        // Same id space, another event: must never lend its name.
        { id: "web", event_id: "other-event", name: "Website hero", sort_order: 0 },
      ],
      images: [
        // The walk's own photos: landed before it finished.
        image("w1", "2026-10-03T19:00:00.000+00:00"),
        // Failed AFTER its row was written, finished by the reconciler: it is
        // in the failure log and it did not need a second try.
        image("w2", "2026-10-03T20:20:00.000+00:00"),
        // A retry's, a day later.
        image("r1", "2026-10-04T19:24:45.224+00:00"),
        image("r2", "2026-10-04T19:24:49.020+00:00"),
        // Uploaded by hand after the import: not the import's.
        image("u1", "2026-10-04T21:00:00.000+00:00", { sps_image_id: null }),
        // Pulled by ANOTHER import and moved into this gallery since (a
        // consolidation). Late creation date, never failed here.
        image("t1", "2026-10-04T22:00:00.000+00:00"),
        // The same SPS id in another event.
        image("x1", "2026-10-04T21:00:00.000+00:00", { event_id: "other-event", sps_image_id: "sps-r1" }),
      ],
      section_images: [
        { section_id: "ik", image_id: "w1" },
        { section_id: "ps", image_id: "w2" },
        { section_id: "ik", image_id: "r1" },
        { section_id: "ps", image_id: "r2" },
        { section_id: "web", image_id: "r2" },
        { section_id: "ps", image_id: "u1" },
        { section_id: "ps", image_id: "t1" },
      ],
    };
  }
  const job = (failures: unknown = failed("w2", "r1", "r2")) => ({
    event_id: EVENT,
    walked_at: WALKED as string | null,
    failures,
  });
  const db = (state: FakeState, opts: { failOn?: keyof FakeState } = {}) =>
    fakeDb(state, opts).db as Parameters<typeof loadRecovered>[0];

  it("is the photos the job failed on that landed after its walk, and only those", async () => {
    // Not w2 (landed during the walk), not u1 (a hand upload), not t1 (moved
    // in from another import), not x1 (another event).
    expect(await loadRecovered(db(gallery()), job())).toEqual({
      total: 2,
      groups: [
        { section: "I–K", count: 1, filenames: ["r1.jpg"] },
        { section: "P–S", count: 1, filenames: ["r2.jpg"] },
      ],
    });
  });

  it("a photo moved in from another import is not 'recovered'", async () => {
    // The whole point of the nomination. Without it t1 reads as a second try.
    const out = await loadRecovered(db(gallery()), job(failed("r1")));
    expect(out?.total).toBe(1);
    expect(out?.groups[0].filenames).toEqual(["r1.jpg"]);
  });

  it("a clean import costs no read at all", async () => {
    const fake = fakeDb(gallery());
    const out = await loadRecovered(fake.db as Parameters<typeof loadRecovered>[0], job([]));
    expect(out).toBeNull();
    expect(fake.reads).toEqual([]);
  });

  it("failures that all landed during the walk: nothing recovered, one read", async () => {
    const fake = fakeDb(gallery());
    const out = await loadRecovered(fake.db as Parameters<typeof loadRecovered>[0], job(failed("w2")));
    expect(out).toBeNull();
    expect(fake.reads).toEqual(["images"]);
  });

  it("a job whose walk has not finished has no answer yet", async () => {
    expect(await loadRecovered(db(gallery()), { ...job(), walked_at: null })).toBeNull();
  });

  it("a failed read throws: the caller decides to show nothing", async () => {
    await expect(
      loadRecovered(db(gallery(), { failOn: "section_images" }), job())
    ).rejects.toMatchObject({ message: expect.stringContaining("statement timeout") });
  });

  it("handles more nominees than one filter can carry", async () => {
    const state = gallery();
    const ids: string[] = [];
    for (let n = 0; n < 250; n++) {
      const id = `s${String(n).padStart(5, "0")}`;
      ids.push(id);
      state.images.push(image(id, "2026-10-04T22:00:00.000+00:00"));
      state.section_images.push({ section_id: "ps", image_id: id });
    }
    const out = await loadRecovered(db(state), job(failed("r1", "r2", ...ids)));
    expect(out?.total).toBe(252);
    expect(out?.groups.map((g) => [g.section, g.count])).toEqual([
      ["I–K", 1],
      ["P–S", 251],
    ]);
  });

  it("a link read that hit the row cap is refused, not shown short", async () => {
    // 100 photos, each in ten sections: 1,000 links for one chunk. A cut
    // answer would file some of them under "Not in a section".
    const state = gallery();
    const ids: string[] = [];
    for (let n = 0; n < 100; n++) {
      const id = `s${String(n).padStart(5, "0")}`;
      ids.push(id);
      state.images.push(image(id, "2026-10-04T22:00:00.000+00:00"));
      for (let w = 0; w < 10; w++) state.section_images.push({ section_id: `sec-${w}`, image_id: id });
    }
    await expect(loadRecovered(db(state), job(failed(...ids)))).rejects.toThrow(/row cap/);
  });
});
