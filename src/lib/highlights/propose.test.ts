import { describe, expect, it } from "vitest";
import { HIGHLIGHT_SAME_PERSON, readFaces, subjectNameKeys, timelineSample } from "./propose";

const img = (id: string, file: string, parsed: string | null = null) => ({
  id,
  parsed_name: parsed,
  original_filename: file,
});

describe("subjectNameKeys (one-per-person by filename)", () => {
  it("camera-named files are not people: no keys, so one-per-person cannot collapse the event", () => {
    const camera = Array.from({ length: 80 }, (_, i) => img(`c${i}`, `IMG_${1000 + i}.jpg`));
    expect(subjectNameKeys(camera).size).toBe(0);
  });

  it("session-labelled files are not people even when the label reads like a name", () => {
    // 98 frames of one session: under the 100-frame event-label floor, and
    // "Guardant" passes as a first name, so only the stacked-gallery gate
    // keeps this from becoming ONE person with one Highlight.
    const session = Array.from({ length: 98 }, (_, i) =>
      img(`s${i}`, `Guardant_Team-Spirit-Night_${i}.jpg`, "Guardant")
    );
    expect(subjectNameKeys(session).size).toBe(0);
  });

  it("a stacked headshot set keys every frame by its person, single first names included", () => {
    const people = ["Ana Lopez", "Ben Cole", "Chen Wu", "Dario", "Luna", "Erin Park"];
    const imgs = people.flatMap((p, k) =>
      Array.from({ length: 6 }, (_, i) => img(`${k}-${i}`, `${p.replace(" ", "_")}_26-11-10_Expo_${k * 10 + i}.jpg`, `${p} Expo`))
    );
    const keys = subjectNameKeys(imgs);
    expect(keys.size).toBe(imgs.length);
    // every frame of one person shares one key, and people differ
    expect(new Set(imgs.filter((i) => i.id.startsWith("4-")).map((i) => keys.get(i.id))).size).toBe(1);
    expect(keys.get("3-0")).not.toBe(keys.get("4-0"));
  });
});

describe("subjectNameKeys: /people's label rules", () => {
  const people = ["Ana Lopez", "Ben Cole", "Chen Wu", "Dara Kim", "Erin Park", "Femi Ade"];
  const stacked = people.flatMap((p, k) =>
    Array.from({ length: 6 }, (_, i) => img(`${k}-${i}`, `${p.replace(" ", "_")}_26-11-10_Expo_${k * 10 + i}.jpg`, `${p} Expo`))
  );

  it("a session-word name ('Name Unknown', 'Team Shots') is never a person", () => {
    const labels = [
      ...Array.from({ length: 20 }, (_, i) => img(`u${i}`, `Name_Unknown_${i}.jpg`, "Name Unknown Expo")),
      ...Array.from({ length: 8 }, (_, i) => img(`t${i}`, `Team_Shots_${i}.jpg`, "Team Shots Expo")),
    ];
    const keys = subjectNameKeys([...stacked, ...labels]);
    expect(labels.some((l) => keys.has(l.id))).toBe(false);
    expect(keys.has("0-0")).toBe(true);
  });

  it("camera-named files inside a stacked headshot set get no person key", () => {
    const camera = Array.from({ length: 12 }, (_, i) => img(`c${i}`, `IMG_${4000 + i}.jpg`));
    const keys = subjectNameKeys([...stacked, ...camera]);
    expect(keys.has("0-0")).toBe(true); // the set is stacked
    expect(camera.some((c) => keys.has(c.id))).toBe(false);
  });

  it("a lone first name keeps its key however long the sitting (Luna: 68 frames)", () => {
    const luna = Array.from({ length: 68 }, (_, i) => img(`l${i}`, `Luna_26-11-12_Expo_${900 + i}.jpg`, "Luna Expo"));
    const keys = subjectNameKeys([...stacked, ...stacked.map((x) => ({ ...x, id: `dup-${x.id}` })), ...luna]);
    expect(keys.has("l0")).toBe(true);
    expect(keys.get("l0")).toBe(keys.get("l67"));
  });

  it("a name holding a big share of a big event labels the event", () => {
    const many = people.flatMap((p, k) =>
      Array.from({ length: 30 }, (_, i) => img(`m${k}-${i}`, `${p.replace(" ", "_")}_x_${i}.jpg`, `${p} Expo`))
    );
    const host = Array.from({ length: 110 }, (_, i) => img(`h${i}`, `Gina_Ross_x_${i}.jpg`, "Gina Ross Expo"));
    const keys = subjectNameKeys([...many, ...host]);
    expect(keys.has("h0")).toBe(false); // 110 of 290 frames: an event label
    expect(keys.has("m0-0")).toBe(true);
  });
});

describe("readFaces paging", () => {
  it("reads past PostgREST's 1,000-row page instead of losing faces", async () => {
    const pages: number[] = [];
    const fake = {
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => ({
              range: async (start: number) => {
                pages.push(start);
                const n = start === 0 ? 1000 : 3;
                return {
                  data: Array.from({ length: n }, (_, i) => ({ id: `${start + i}`, image_id: "img1", person_id: null, bbox_w: 1, bbox_h: 1 })),
                  error: null,
                };
              },
            }),
          }),
        }),
      }),
    };
    const out = await readFaces(fake as never, ["img1"]);
    expect(out.get("img1")).toHaveLength(1003);
    expect(pages).toEqual([0, 1000]);
  });
});

describe("timelineSample", () => {
  it("spreads over the WHOLE event, end included, when the count does not divide evenly", () => {
    const moments = Array.from({ length: 800 }, (_, i) => i);
    const sample = timelineSample(moments, 420);
    expect(sample).toHaveLength(420);
    expect(Math.max(...sample)).toBeGreaterThan(790); // a stride + slice stopped at 419
    expect(new Set(sample).size).toBe(420);
  });
  it("returns everything when asked for at least as many as exist", () => {
    expect(timelineSample([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });
});

describe("HIGHLIGHT_SAME_PERSON", () => {
  it("catches the Team Curry repeat: one guest, frontal vs kissing in profile, matched at 0.434", () => {
    expect(HIGHLIGHT_SAME_PERSON).toBeLessThan(0.434);
    // and stays above how far apart different people have ever measured
    expect(HIGHLIGHT_SAME_PERSON).toBeGreaterThanOrEqual(0.363);
  });
});
