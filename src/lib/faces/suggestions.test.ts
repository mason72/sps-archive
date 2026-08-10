import { describe, expect, it } from "vitest";

import { computeSuggestions, type SuggestionPerson } from "./suggestions";

const extract = (filename: string) => {
  const namePart = filename.replace(/\.[^.]+$/, "").split("_")[0];
  return /^[A-Za-z]+ [A-Za-z]+$/.test(namePart) ? namePart : "";
};
const personLike = (name: string) => /^[A-Za-z]+ [A-Za-z]+$/.test(name);

const jenna: SuggestionPerson = {
  id: "p-jenna",
  name: "Jenna Loeser",
  imageIds: ["i1", "i2", "i3", "i4", "i5", "i6"],
  faceCount: 6,
};

const meta = (entries: Record<string, string | { p: string }>) =>
  new Map(
    Object.entries(entries).map(([id, v]) => [
      id,
      typeof v === "string"
        ? { parsedName: null, originalFilename: v }
        : { parsedName: v.p, originalFilename: "whatever.jpg" },
    ])
  );

describe("computeSuggestions — mislabels", () => {
  it("flags the minority outlier (the Jenna/Katie case)", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Jenna Loeser_5.jpg",
      i6: "Katie Zeff_177.jpg",
    });
    const { mislabels } = computeSuggestions([jenna], m, extract, personLike, new Set());
    expect(mislabels).toHaveLength(1);
    expect(mislabels[0]).toMatchObject({ imageId: "i6", filedAs: "Katie Zeff" });
  });

  it("a fixed parsedName clears the suggestion", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Jenna Loeser_5.jpg",
      i6: { p: "Jenna Loeser" }, // accepted fix
    });
    const { mislabels } = computeSuggestions([jenna], m, extract, personLike, new Set());
    expect(mislabels).toHaveLength(0);
  });

  it("suppresses mislabels when disagreement is the majority (cluster name is the suspect)", () => {
    const m = meta({
      i1: "Katie Zeff_1.jpg",
      i2: "Katie Zeff_2.jpg",
      i3: "Katie Zeff_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Katie Zeff_5.jpg",
      i6: "Katie Zeff_6.jpg",
    });
    const { mislabels } = computeSuggestions([jenna], m, extract, personLike, new Set());
    expect(mislabels).toHaveLength(0);
  });

  it("honors dismissals", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Jenna Loeser_5.jpg",
      i6: "Katie Zeff_177.jpg",
    });
    const { mislabels } = computeSuggestions(
      [jenna],
      m,
      extract,
      personLike,
      new Set(["mislabel:i6:p-jenna"])
    );
    expect(mislabels).toHaveLength(0);
  });

  it("unnamed persons produce nothing", () => {
    const anon = { ...jenna, name: null };
    const m = meta({ i1: "Katie Zeff_1.jpg" });
    const { mislabels } = computeSuggestions([anon], m, extract, personLike, new Set());
    expect(mislabels).toHaveLength(0);
  });
});

describe("computeSuggestions — merges", () => {
  it("suggests merging same-named fragments, smaller into larger", () => {
    const big = { id: "p1", name: "Katie Zeff", imageIds: ["a"], faceCount: 20 };
    const small = { id: "p2", name: "katie zeff", imageIds: ["b"], faceCount: 2 };
    const { merges } = computeSuggestions([big, small], new Map(), extract, personLike, new Set());
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({ fromId: "p2", intoId: "p1" });
  });

  it("distinct names never merge", () => {
    const a = { id: "p1", name: "Katie Zeff", imageIds: [], faceCount: 5 };
    const b = { id: "p2", name: "Jenna Loeser", imageIds: [], faceCount: 5 };
    const { merges } = computeSuggestions([a, b], new Map(), extract, personLike, new Set());
    expect(merges).toHaveLength(0);
  });
});
