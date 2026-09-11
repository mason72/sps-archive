import { describe, expect, it } from "vitest";

import { groupEventsByFace } from "./face-split";

const photos = (entries: Record<string, number>) => new Map(Object.entries(entries));

describe("groupEventsByFace", () => {
  it("splits a name whose faces never match — the five Alexes (2026-09-11)", () => {
    // Real similarities from the census: every pair between -0.10 and 0.14.
    const evs = ["dais", "docusign", "chime", "stripe", "rldatix"];
    const sims = [];
    for (let i = 0; i < evs.length; i++)
      for (let j = i + 1; j < evs.length; j++) sims.push({ a: evs[i], b: evs[j], sim: 0.05 });
    const groups = groupEventsByFace(
      evs,
      photos({ dais: 15, docusign: 12, chime: 20, stripe: 20, rldatix: 10 }),
      sims
    );
    expect(groups).toHaveLength(5);
    // Largest first, ties broken by id so the base card is stable.
    expect(groups[0]).toEqual(["chime"]);
  });

  it("keeps one person together across shoots when the faces match", () => {
    const groups = groupEventsByFace(
      ["a", "b", "c"],
      photos({ a: 10, b: 10, c: 10 }),
      [
        { a: "a", b: "b", sim: 0.88 },
        { a: "b", b: "c", sim: 0.91 },
        { a: "a", b: "c", sim: 0.86 },
      ]
    );
    expect(groups).toHaveLength(1);
  });

  it("joins a duplicate gallery (identical photos score 1.000) and splits the rest", () => {
    // Brandon: both NASAI galleries are one shoot; Docusign is someone else.
    const groups = groupEventsByFace(
      ["nasai", "collegeboard", "docusign"],
      photos({ nasai: 13, collegeboard: 13, docusign: 12 }),
      [
        { a: "nasai", b: "collegeboard", sim: 1.0 },
        { a: "nasai", b: "docusign", sim: 0.035 },
        { a: "collegeboard", b: "docusign", sim: 0.035 },
      ]
    );
    expect(groups).toEqual([["nasai", "collegeboard"], ["docusign"]]);
  });

  it("puts an event with no usable face on the largest card — never its own", () => {
    // Brandon's Applovin frames are group shots: no solo face, no evidence.
    const groups = groupEventsByFace(
      ["nasai", "docusign", "applovin"],
      photos({ nasai: 13, docusign: 12, applovin: 2 }),
      [{ a: "nasai", b: "docusign", sim: 0.03 }]
    );
    expect(groups).toEqual([["nasai", "applovin"], ["docusign"]]);
  });

  it("does not split on a single piece of evidence", () => {
    expect(groupEventsByFace(["a", "b"], photos({ a: 5, b: 5 }), [])).toEqual([["a", "b"]]);
  });
});

describe("human 'same person' links", () => {
  const evs = ["chime", "docusign", "stripe"];
  const apart = [
    { a: "chime", b: "docusign", sim: 0.02 },
    { a: "chime", b: "stripe", sim: 0.04 },
    { a: "docusign", b: "stripe", sim: 0.1 },
  ];

  it("re-joins two shoots the faces kept apart", () => {
    const groups = groupEventsByFace(
      evs,
      photos({ chime: 20, docusign: 12, stripe: 20 }),
      apart,
      [["docusign", "stripe"]]
    );
    expect(groups).toEqual([["docusign", "stripe"], ["chime"]]);
  });

  it("places a no-face shoot where the human linked it, not on the largest card", () => {
    const groups = groupEventsByFace(
      ["chime", "docusign", "applovin"],
      photos({ chime: 20, docusign: 12, applovin: 2 }),
      [{ a: "chime", b: "docusign", sim: 0.02 }],
      [["applovin", "docusign"]]
    );
    expect(groups).toEqual([["chime"], ["docusign", "applovin"]]);
  });

  it("ignores a link to an event this name no longer has", () => {
    const groups = groupEventsByFace(
      evs,
      photos({ chime: 20, docusign: 12, stripe: 20 }),
      apart,
      [["docusign", "gone-event"]]
    );
    expect(groups).toHaveLength(3);
  });
});
