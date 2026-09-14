import { describe, expect, it } from "vitest";

import { consensusName, frameName, nameIsRejected, type FrameName } from "./cluster-event";

const personLike = (name: string) => /^[A-Za-z]+ [A-Za-z]+$/.test(name);

/** Toy votes: "Jenna Loeser" → key "jennaloeser"; null = a frame naming nobody. */
function votes(entries: Record<string, string | null>) {
  const map = new Map<string, FrameName | null>(
    Object.entries(entries).map(([id, name]) => [
      id,
      name ? { key: name.toLowerCase().replace(/[^a-z]/g, ""), spelling: name } : null,
    ])
  );
  return { ids: Object.keys(entries), map };
}

describe("consensusName", () => {
  it("names a cluster whose files agree", () => {
    const { ids, map } = votes({ a: "Jenna Loeser", b: "Jenna Loeser", c: "Jenna Loeser" });
    expect(consensusName(ids, map, personLike)).toBe("Jenna Loeser");
  });

  it("tolerates one mislabeled file at 80% dominance", () => {
    const { ids, map } = votes({
      a: "Jenna Loeser",
      b: "Jenna Loeser",
      c: "Jenna Loeser",
      d: "Jenna Loeser",
      e: "Katie Zeff",
    });
    expect(consensusName(ids, map, personLike)).toBe("Jenna Loeser");
  });

  it("stays blank when consensus is weak", () => {
    const { ids, map } = votes({ a: "Jenna Loeser", b: "Katie Zeff", c: "Avery Romano" });
    expect(consensusName(ids, map, personLike)).toBeNull();
  });

  it("counts a frame that names nobody against the consensus", () => {
    const { ids, map } = votes({ a: "Jenna Loeser", b: "Jenna Loeser", c: null });
    expect(consensusName(ids, map, personLike)).toBeNull();
  });

  it("needs at least two supporting files", () => {
    const { ids, map } = votes({ a: "Jenna Loeser" });
    expect(consensusName(ids, map, personLike)).toBeNull();
  });

  it("rejects a consensus the person-name detector dislikes", () => {
    const { ids, map } = votes({ a: "Jenna Loeser", b: "Jenna Loeser" });
    expect(consensusName(ids, map, () => false)).toBeNull();
  });
});

// Real filenames and stored parsed_name values from production, 2026-09-14.
describe("frameName (lesson 145)", () => {
  it("names a dated headshot the way the wall does", () => {
    expect(frameName("Jenna Loeser CollegeBoard", "Jenna Loeser_26-06-04_CollegeBoard_0001.jpg")).toEqual({
      key: "jennaloeser",
      spelling: "Jenna Loeser",
    });
  });

  it("shows a fused name split, since both readers agree on the key", () => {
    expect(frameName("ChristinaDePinto", "ChristinaDePinto_26-01-27_2322.jpg")).toEqual({
      key: "christinadepinto",
      spelling: "Christina De Pinto",
    });
  });

  it("never names a fused event tag the wall leaves unnamed", () => {
    // The raw reading is "Lauren Smith Data Dog Headshots"; 22 clusters got it.
    expect(
      frameName("LaurenSmithDataDogHeadshots NYC28865", "LaurenSmithDataDogHeadshots_NYC28865.jpg")
    ).toBeNull();
  });

  it("never names a session label the parser reassembles", () => {
    // The wall's reading alone is "Guardant Team Spirit Night".
    expect(frameName("Guardant Team Spirit Night", "Guardant_Team-Spirit-Night_12.jpg")).toBeNull();
  });

  it("casts no vote on the WEKA gallery filename", () => {
    expect(frameName("WekaSKO27 EventPhotos", "WekaSKO27_EventPhotos-03055.jpg")).toBeNull();
  });

  it("stays blank where the wall's parse disagrees, rather than taking a side", () => {
    // The parser drops the O ("Lisa Brien"): a parser bug, fixed there or nowhere.
    expect(frameName("Lisa Brien", "LisaOBrien_26-01-27_3979.jpg")).toBeNull();
  });
});

describe("nameIsRejected", () => {
  it("rejects the exact cleared name", () => {
    expect(nameIsRejected("Jenna Wombles", ["Jenna Wombles"])).toBe(true);
  });
  it("rejects spelling variants of a cleared name", () => {
    expect(nameIsRejected("jenna wombles", ["Jenna Wombles"])).toBe(true);
    expect(nameIsRejected("JennaWombles", ["Jenna Wombles"])).toBe(true);
    expect(nameIsRejected("Jenna-Wombles", ["Jenna Wombles"])).toBe(true);
  });
  it("does not reject a different person's name", () => {
    expect(nameIsRejected("Jenna Loeser", ["Jenna Wombles"])).toBe(false);
  });
  it("is a no-op with nothing rejected", () => {
    expect(nameIsRejected("Jenna Wombles", [])).toBe(false);
  });
});
