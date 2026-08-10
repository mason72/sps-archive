import { describe, expect, it } from "vitest";

import { filenameSplitGroups, proposeSplit, type SplitFace } from "./split";

const extract = (filename: string) => {
  const namePart = filename.replace(/\.[^.]+$/, "").split("_")[0];
  return /^[A-Za-z]+( [A-Za-z]+)+$/.test(namePart) ? namePart : "";
};
const personLike = (name: string) => /^[A-Za-z]+( [A-Za-z]+)+$/.test(name);

/** Unit vectors in 4-dim space; the math is dimension-agnostic. */
const A = [1, 0, 0, 0];
const B = [0, 1, 0, 0];
function near(axis: number[], wobble = 0.15): number[] {
  const v = axis.map((x, i) => x + (i === 3 ? wobble : 0));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

let seq = 0;
function face(embedding: number[], imageId?: string, quality = 0.8): SplitFace {
  seq += 1;
  return { id: `f${seq}`, imageId: imageId ?? `i${seq}`, embedding, quality };
}

function filenames(entries: Record<string, string>) {
  return new Map(Object.entries(entries));
}

describe("filenameSplitGroups", () => {
  it("finds two disagreeing name groups with enough support", () => {
    const ids = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const map = filenames({
      a1: "Abhudaya Shrivastava_1.jpg",
      a2: "Abhudaya Shrivastava_2.jpg",
      a3: "Abhudaya Shrivastava_3.jpg",
      b1: "Anth Srinivas_1.jpg",
      b2: "Anth Srinivas_2.jpg",
      b3: "Anth Srinivas_3.jpg",
    });
    const groups = filenameSplitGroups(ids, map, extract, personLike);
    expect(groups).toHaveLength(2);
    expect(groups!.map((g) => g.name).sort()).toEqual([
      "Abhudaya Shrivastava",
      "Anth Srinivas",
    ]);
  });

  it("name families do NOT define a split (Sami vs Sami Mundra)", () => {
    const ids = ["a1", "a2", "a3", "b1", "b2", "b3"];
    const map = filenames({
      a1: "Sami Hadouaj_1.jpg",
      a2: "Sami Hadouaj_2.jpg",
      a3: "Sami Hadouaj_3.jpg",
      b1: "Sami Hadouaj Mundra_1.jpg",
      b2: "Sami Hadouaj Mundra_2.jpg",
      b3: "Sami Hadouaj Mundra_3.jpg",
    });
    expect(filenameSplitGroups(ids, map, extract, personLike)).toBeNull();
  });

  it("needs SPLIT_MIN_SUPPORT on both sides", () => {
    const ids = ["a1", "a2", "a3", "b1"];
    const map = filenames({
      a1: "Jenna Loeser_1.jpg",
      a2: "Jenna Loeser_2.jpg",
      a3: "Jenna Loeser_3.jpg",
      b1: "Katie Zeff_1.jpg", // one mislabel ≠ a second person
    });
    expect(filenameSplitGroups(ids, map, extract, personLike)).toBeNull();
  });
});

describe("proposeSplit", () => {
  it("filename basis: groups follow the files, leftovers join by face", () => {
    const faces = [
      face(near(A), "a1"),
      face(near(A, 0.2), "a2"),
      face(near(A, 0.1), "a3"),
      face(near(B), "b1"),
      face(near(B, 0.2), "b2"),
      face(near(B, 0.1), "b3"),
      face(near(B, 0.05), "x1"), // junk-named, face resembles B
    ];
    const map = filenames({
      a1: "Alice Smith_1.jpg",
      a2: "Alice Smith_2.jpg",
      a3: "Alice Smith_3.jpg",
      b1: "Bella Jones_1.jpg",
      b2: "Bella Jones_2.jpg",
      b3: "Bella Jones_3.jpg",
      x1: "IMG9999.jpg",
    });
    const p = proposeSplit(faces, map, extract, personLike);
    expect(p?.basis).toBe("filenames");
    // Larger group first: B side has 4 (3 named + the leftover).
    expect(p!.groups[0].seedName).toBe("Bella Jones");
    expect(p!.groups[0].faceIds).toHaveLength(4);
    expect(p!.groups[1].seedName).toBe("Alice Smith");
    expect(p!.groups[1].faceIds).toHaveLength(3);
  });

  it("faces fallback splits two embedding clumps under junk filenames", () => {
    const faces = [
      face(near(A)),
      face(near(A, 0.2)),
      face(near(A, 0.1)),
      face(near(B)),
      face(near(B, 0.2)),
    ];
    const map = filenames({});
    const p = proposeSplit(faces, map, extract, personLike);
    expect(p?.basis).toBe("faces");
    expect(p!.groups[0].faceIds).toHaveLength(3);
    expect(p!.groups[1].faceIds).toHaveLength(2);
    expect(p!.groups[1].seedName).toBeNull();
  });

  it("refuses to split a genuinely single person", () => {
    const faces = [face(near(A)), face(near(A, 0.05)), face(near(A, 0.1)), face(near(A, 0.12))];
    expect(proposeSplit(faces, filenames({}), extract, personLike)).toBeNull();
  });
});

describe("fallback minority guard", () => {
  it("a lone outlier face is not a second person", () => {
    const faces = [
      face(near(A)),
      face(near(A, 0.05)),
      face(near(A, 0.1)),
      face(near(A, 0.12)),
      face(near(A, 0.08)),
      face(near(B)), // one odd shot
    ];
    expect(proposeSplit(faces, filenames({}), extract, personLike)).toBeNull();
  });
});
