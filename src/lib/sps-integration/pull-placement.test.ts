import { describe, it, expect } from "vitest";
import type { SpsManifestImage } from "./pull-client";
import { fakeDb as fakeDbOf, type FakeState as State } from "./testing/fake-db";
import {
  chooseHome,
  homesAmong,
  planSweepPlacement,
  stackMates,
  type PlacementSection,
} from "./pull-placement";

const EVENT = "event-1";

const incoming = (id: string, originalFilename: string): SpsManifestImage => ({
  id,
  originalFilename,
  width: null,
  height: null,
  mimeType: "image/jpeg",
  capturedAt: null,
  boothId: null,
  quality: "archive",
  alreadyPulled: false,
  url: `https://sps.example/${id}`,
});

/** A row as the upload parser stored it: the event tag rides in parsed_name. */
const row = (id: string, originalFilename: string, parsedName: string | null) => ({
  id,
  originalFilename,
  parsedName,
});

/**
 * A retried photo is filed beside its person or it is not. Both wrong answers
 * are quiet: too eager and a photo lands in a section its person is not in;
 * too timid and a delivered gallery grows an "Unsorted" tab of strays, which
 * is what this module exists to stop (AAOMS 2026, five photos).
 */
describe("stackMates", () => {
  const existing = [
    row("i1", "avery stone_26-09-30_Summit_0140.jpg", "avery stone Summit"),
    row("i2", "avery stone_26-09-30_Summit_0142.jpg", "avery stone Summit"),
    row("i3", "Morgan Reyes_26-09-30_Summit_1020.jpg", "Morgan Reyes Summit"),
    row("i4", "Jordan Pike_26-10-01_Summit_1301.jpg", "Jordan Pike Summit"),
  ];

  it("finds the person's photos by the stack rule, not by raw text", () => {
    // The shapes AAOMS 2026 had, with invented names (guests' names do not
    // belong in a fixture). The parser stored "… Summit" in parsed_name, and
    // one name was typed with its capitals inverted: the stack rule sees
    // through both.
    const mates = stackMates(existing, [
      incoming("s1", "avery stone_26-09-30_Summit_0141.jpg"),
      incoming("s2", "mORGAN reyes_26-09-30_Summit_1024.jpg"),
    ]);
    expect(mates.get("s1")).toEqual(["i1", "i2"]);
    expect(mates.get("s2")).toEqual(["i3"]);
  });

  it("a person with no photos here has no mates", () => {
    const mates = stackMates(existing, [incoming("s1", "sam okafor_26-10-01_Summit_2123.jpg")]);
    expect(mates.get("s1")).toEqual([]);
  });

  it("two incoming photos of one person share one lookup", () => {
    const mates = stackMates(existing, [
      incoming("s1", "mORGAN reyes_26-09-30_Summit_1024.jpg"),
      incoming("s2", "mORGAN reyes_26-09-30_Summit_1021.jpg"),
    ]);
    expect(mates.get("s1")).toBe(mates.get("s2"));
    // Each other is not "already here".
    expect(mates.get("s1")).toEqual(["i3"]);
  });
});

describe("homesAmong / chooseHome", () => {
  const sections = new Map<string, PlacementSection>(
    [
      { id: "hl", name: "Highlights", locked: false },
      { id: "ab", name: "A–B", locked: false },
      { id: "ps", name: "P–S", locked: false },
      { id: "vault", name: "Finals", locked: true },
      { id: "in", name: "Unsorted", locked: false },
    ].map((s) => [s.id, s])
  );
  const pick = (memberships: string[]) => chooseHome(homesAmong(memberships, sections), sections);

  it("exactly one section holds the person: that section", () => {
    expect(pick(["ps", "ps", "ps"])).toBe("ps");
  });

  it("two sections hold them: no single home", () => {
    expect(pick(["ab", "ps"])).toBeNull();
  });

  it("nobody's photos are anywhere: no home", () => {
    expect(pick([])).toBeNull();
  });

  it("Highlights is a copy, not a home", () => {
    // A person with a pick in Highlights still lives in their letter section.
    expect(pick(["ps", "hl"])).toBe("ps");
    // And Highlights alone is never a landing place.
    expect(pick(["hl"])).toBeNull();
  });

  it("Unsorted is 'not filed', not a home", () => {
    // One stray already in the intake must not drag the person's next photo
    // there too (which is how a five-photo Unsorted tab would keep growing).
    expect(pick(["ps", "in"])).toBe("ps");
    // Everything in the intake: no home. The fallback is the intake itself.
    expect(pick(["in", "in"])).toBeNull();
  });

  it("a link into another event's section does not count", () => {
    // The same photo published to a website gallery.
    expect(pick(["ps", "some-other-events-section"])).toBe("ps");
  });

  it("a locked section holds photos but cannot receive one", () => {
    expect(pick(["vault"])).toBeNull();
    // It still counts as a home, so it cannot be ignored in favour of another.
    expect(pick(["vault", "ps"])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// planSweepPlacement, against an in-memory stand-in for the three tables
// ─────────────────────────────────────────────────────────────────────────────

const fakeDb = (state: State, opts: { failOn?: keyof State } = {}) => {
  const fake = fakeDbOf(state, opts);
  return { ...fake, db: fake.db as unknown as Parameters<typeof planSweepPlacement>[0] };
};

const image = (id: string, name: string, frame: string) => ({
  id,
  event_id: EVENT,
  parsed_name: `${name} Summit`,
  original_filename: `${name}_26-09-30_Summit_${frame}.jpg`,
});

/** A sorted gallery: letter sections, Highlights, no "Unsorted". */
function sortedGallery(): State {
  return {
    sections: [
      { id: "hl", event_id: EVENT, name: "Highlights", locked: false, sort_order: 0 },
      { id: "ik", event_id: EVENT, name: "I–K", locked: false, sort_order: 3 },
      { id: "ps", event_id: EVENT, name: "P–S", locked: false, sort_order: 5 },
    ],
    images: [
      image("i1", "avery stone", "0140"),
      image("i2", "avery stone", "0142"),
      image("i3", "Morgan Reyes", "1020"),
    ],
    section_images: [
      { section_id: "ik", image_id: "i1", sort_order: 40 },
      { section_id: "ik", image_id: "i2", sort_order: 41 },
      { section_id: "hl", image_id: "i2", sort_order: 0 },
      { section_id: "ps", image_id: "i3", sort_order: 7 },
    ],
  };
}

const sectionName = (state: State, id: string) => state.sections.find((s) => s.id === id)?.name;

describe("planSweepPlacement", () => {
  it("files each photo beside its person, and creates no Unsorted section", async () => {
    const state = sortedGallery();
    const { db, inserts } = fakeDb(state);
    const batch = [
      incoming("s1", "avery stone_26-09-30_Summit_0141.jpg"),
      incoming("s2", "mORGAN reyes_26-09-30_Summit_1024.jpg"),
      incoming("s3", "mORGAN reyes_26-09-30_Summit_1021.jpg"),
    ];
    const place = await planSweepPlacement(db, EVENT, batch);

    // After what each section already holds, never two at one position.
    expect(await place(batch[0])).toEqual({ sectionId: "ik", sortOrder: 42 });
    expect(await place(batch[1])).toEqual({ sectionId: "ps", sortOrder: 8 });
    expect(await place(batch[2])).toEqual({ sectionId: "ps", sortOrder: 9 });
    expect(inserts).toEqual([]);
    expect(state.sections.map((s) => s.name)).not.toContain("Unsorted");
  });

  it("creates Unsorted when a photo that needs it LANDS, not when it is planned", async () => {
    const state = sortedGallery();
    const { db, inserts } = fakeDb(state);
    const batch = [
      incoming("s1", "avery stone_26-09-30_Summit_0141.jpg"),
      // Nobody by this name is in the gallery.
      incoming("s2", "sam okafor_26-10-01_Summit_2123.jpg"),
      incoming("s3", "nobody atall_26-10-01_Summit_0001.jpg"),
    ];
    const place = await planSweepPlacement(db, EVENT, batch);

    // Planned, and the homed photo placed: still no Unsorted. If the two
    // strays fail to download (they are on a retry list because they failed
    // before), the delivered gallery never grows an empty tab.
    expect(await place(batch[0])).toEqual({ sectionId: "ik", sortOrder: 42 });
    expect(inserts).toEqual([]);

    // Two workers ask at once: ONE section, two positions.
    const [a, b] = await Promise.all([place(batch[1]), place(batch[2])]);
    expect(inserts).toEqual(["sections"]);
    expect(sectionName(state, a.sectionId)).toBe("Unsorted");
    expect(b.sectionId).toBe(a.sectionId);
    expect([a.sortOrder, b.sortOrder].sort()).toEqual([0, 1]);
  });

  it("a person split across two sections goes to the intake", async () => {
    const state = sortedGallery();
    state.section_images.push({ section_id: "ps", image_id: "i1", sort_order: 99 });
    const { db } = fakeDb(state);
    const batch = [incoming("s1", "avery stone_26-09-30_Summit_0141.jpg")];
    const { sectionId } = await (await planSweepPlacement(db, EVENT, batch))(batch[0]);
    expect(sectionName(state, sectionId)).toBe("Unsorted");
  });

  it("a locked home receives nothing", async () => {
    const state = sortedGallery();
    state.sections.find((s) => s.id === "ps")!.locked = true;
    const { db } = fakeDb(state);
    const batch = [incoming("s1", "mORGAN reyes_26-09-30_Summit_1024.jpg")];
    const { sectionId } = await (await planSweepPlacement(db, EVENT, batch))(batch[0]);
    expect(sectionId).not.toBe("ps");
    expect(sectionName(state, sectionId)).toBe("Unsorted");
  });

  it("a stray already in Unsorted does not pull the person's next photo there", async () => {
    const state = sortedGallery();
    state.sections.push({ id: "in", event_id: EVENT, name: "Unsorted", locked: false, sort_order: 0 });
    state.images.push(image("i9", "avery stone", "0139"));
    state.section_images.push({ section_id: "in", image_id: "i9", sort_order: 0 });
    const { db } = fakeDb(state);
    const batch = [incoming("s1", "avery stone_26-09-30_Summit_0141.jpg")];
    expect(await (await planSweepPlacement(db, EVENT, batch))(batch[0])).toEqual({
      sectionId: "ik",
      sortOrder: 42,
    });
  });

  it("an unsorted gallery behaves as it always did: everything in the intake", async () => {
    // The first run's sweep. Nothing is filed yet, so nobody has a home, and
    // every photo appends to the intake the walk filled.
    const state = sortedGallery();
    state.sections = [
      { id: "hl", event_id: EVENT, name: "Highlights", locked: false, sort_order: 1 },
      { id: "in", event_id: EVENT, name: "Unsorted", locked: false, sort_order: 0 },
    ];
    state.section_images = [
      { section_id: "in", image_id: "i1", sort_order: 0 },
      { section_id: "in", image_id: "i2", sort_order: 1 },
      { section_id: "in", image_id: "i3", sort_order: 2 },
    ];
    const { db, inserts } = fakeDb(state);
    const batch = [
      incoming("s1", "avery stone_26-09-30_Summit_0141.jpg"),
      incoming("s2", "sam okafor_26-10-01_Summit_2123.jpg"),
    ];
    const place = await planSweepPlacement(db, EVENT, batch);
    expect(await place(batch[0])).toEqual({ sectionId: "in", sortOrder: 3 });
    expect(await place(batch[1])).toEqual({ sectionId: "in", sortOrder: 4 });
    expect(inserts).toEqual([]);
  });

  it("a lookup that cannot be read places nothing: it throws", async () => {
    // Not a fallback to Unsorted. That would rebuild the stray tab whenever
    // the database is struggling, and a landed photo is never placed again.
    const state = sortedGallery();
    const { db, inserts } = fakeDb(state, { failOn: "images" });
    const batch = [incoming("s1", "avery stone_26-09-30_Summit_0141.jpg")];
    await expect(planSweepPlacement(db, EVENT, batch)).rejects.toMatchObject({
      message: expect.stringContaining("statement timeout"),
    });
    expect(inserts).toEqual([]);
  });

  it("a failed intake lookup is asked again by the next photo", async () => {
    const state = sortedGallery();
    const flaky = fakeDb(state);
    const batch = [
      incoming("s1", "sam okafor_26-10-01_Summit_2123.jpg"),
      incoming("s2", "nobody atall_26-10-01_Summit_0001.jpg"),
    ];
    const place = await planSweepPlacement(flaky.db, EVENT, batch);
    // The intake lookup reads `sections`; break it for one call.
    const realFrom = (flaky.db as unknown as { from: (t: string) => unknown }).from;
    let broken = true;
    (flaky.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
      if (broken && t === "sections") {
        broken = false;
        throw new Error("connection reset");
      }
      return realFrom(t);
    };
    await expect(place(batch[0])).rejects.toThrow("connection reset");
    expect(sectionName(state, (await place(batch[1])).sectionId)).toBe("Unsorted");
  });
});

/**
 * The same lookups at real size. PostgREST caps a response at 1,000 rows and
 * says nothing when it does, so every loop here has a way to read short and
 * look complete.
 */
describe("planSweepPlacement at gallery scale", () => {
  const pad = (n: number) => String(n).padStart(5, "0");

  function bigGallery(): State {
    const state = sortedGallery();
    // 2,400 other people, one photo each, so the person we want is spread
    // across the third page of the event's rows.
    for (let n = 0; n < 2400; n++) {
      state.images.push(image(`a${pad(n)}`, `Filler Person${n}`, pad(n)));
      state.section_images.push({ section_id: "ik", image_id: `a${pad(n)}`, sort_order: n });
    }
    return state;
  }

  it("reads past the first 1,000 rows to find the person", async () => {
    const state = bigGallery();
    // Sorts after every "a…" and "i…" id: only reachable by paging.
    state.images.push(image("z1", "Zed Last", "9001"));
    state.section_images.push({ section_id: "ps", image_id: "z1", sort_order: 50 });
    const { db } = fakeDb(state);
    const batch = [incoming("s1", "Zed Last_26-09-30_Summit_9002.jpg")];
    expect(await (await planSweepPlacement(db, EVENT, batch))(batch[0])).toEqual({
      sectionId: "ps",
      sortOrder: 51,
    });
  });

  it("checks EVERY photo of a large stack before calling it one home", async () => {
    const state = sortedGallery();
    for (let n = 0; n < 250; n++) {
      state.images.push(image(`m${pad(n)}`, "Booth Crowd", pad(n)));
      // All in P–S except the very last, which only the third chunk reaches.
      state.section_images.push({
        section_id: n === 249 ? "ik" : "ps",
        image_id: `m${pad(n)}`,
        sort_order: 100 + n,
      });
    }
    const { db } = fakeDb(state);
    const batch = [incoming("s1", "Booth Crowd_26-09-30_Summit_9999.jpg")];
    const { sectionId } = await (await planSweepPlacement(db, EVENT, batch))(batch[0]);
    expect(sectionName(state, sectionId)).toBe("Unsorted");
  });

  it("a response that hit the row cap is 'unknown', never 'one home'", async () => {
    const state = sortedGallery();
    // 100 photos, each in P–S and published to nine website sections of other
    // events: 1,000 links for one chunk of ids. The capped answer could be
    // hiding a second home, so the photo is not filed on it.
    for (let n = 0; n < 100; n++) {
      state.images.push(image(`m${pad(n)}`, "Booth Crowd", pad(n)));
      state.section_images.push({ section_id: "ps", image_id: `m${pad(n)}`, sort_order: 100 + n });
      for (let w = 0; w < 9; w++) {
        state.section_images.push({ section_id: `web-${w}`, image_id: `m${pad(n)}`, sort_order: n });
      }
    }
    const { db } = fakeDb(state);
    const batch = [incoming("s1", "Booth Crowd_26-09-30_Summit_9999.jpg")];
    const { sectionId } = await (await planSweepPlacement(db, EVENT, batch))(batch[0]);
    expect(sectionName(state, sectionId)).toBe("Unsorted");
  });
});
