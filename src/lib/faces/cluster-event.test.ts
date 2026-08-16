import { describe, expect, it } from "vitest";

import { consensusName, nameIsRejected } from "./cluster-event";

const extract = (filename: string) => {
  // Toy extractor: "First Last_001.jpg" → "First Last"; camera codes → "".
  const stem = filename.replace(/\.[^.]+$/, "");
  const namePart = stem.split("_")[0];
  return /^[A-Za-z]+ [A-Za-z]+$/.test(namePart) ? namePart : "";
};
const personLike = (name: string) => /^[A-Za-z]+ [A-Za-z]+$/.test(name);

function files(entries: Record<string, string>) {
  return {
    ids: Object.keys(entries),
    map: new Map(Object.entries(entries)),
  };
}

describe("consensusName", () => {
  it("names a cluster whose files agree", () => {
    const { ids, map } = files({
      a: "Jenna Loeser_001.jpg",
      b: "Jenna Loeser_002.jpg",
      c: "Jenna Loeser_003.jpg",
    });
    expect(consensusName(ids, map, extract, personLike)).toBe("Jenna Loeser");
  });

  it("tolerates one mislabeled file at 80% dominance", () => {
    const { ids, map } = files({
      a: "Jenna Loeser_001.jpg",
      b: "Jenna Loeser_002.jpg",
      c: "Jenna Loeser_003.jpg",
      d: "Jenna Loeser_004.jpg",
      e: "Katie Zeff_177.jpg",
    });
    expect(consensusName(ids, map, extract, personLike)).toBe("Jenna Loeser");
  });

  it("stays blank when consensus is weak", () => {
    const { ids, map } = files({
      a: "Jenna Loeser_001.jpg",
      b: "Katie Zeff_001.jpg",
      c: "Avery Romano_001.jpg",
    });
    expect(consensusName(ids, map, extract, personLike)).toBeNull();
  });

  it("stays blank on camera-code filenames", () => {
    const { ids, map } = files({
      a: "IMG4021_001.jpg",
      b: "IMG4022_002.jpg",
      c: "IMG4023_003.jpg",
    });
    expect(consensusName(ids, map, extract, personLike)).toBeNull();
  });

  it("needs at least two supporting files", () => {
    const { ids, map } = files({ a: "Jenna Loeser_001.jpg" });
    expect(consensusName(ids, map, extract, personLike)).toBeNull();
  });

  it("rejects a consensus the person-name detector dislikes", () => {
    const rejectAll = () => false;
    const { ids, map } = files({
      a: "Jenna Loeser_001.jpg",
      b: "Jenna Loeser_002.jpg",
    });
    expect(consensusName(ids, map, extract, rejectAll)).toBeNull();
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
