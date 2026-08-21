import { describe, expect, it } from "vitest";

import { computeSuggestions, sameNameFamily, type SuggestionPerson } from "./suggestions";

const extract = (filename: string) => {
  // Toy extractor: "First Last[ Extra]_001.jpg" → name part before "_".
  const namePart = filename.replace(/\.[^.]+$/, "").split("_")[0];
  return /^[A-Za-z]+( [A-Za-z]+)+$/.test(namePart) ? namePart : "";
};
const personLike = (name: string) => /^[A-Za-z]+( [A-Za-z]+)+$/.test(name);

const jenna: SuggestionPerson = {
  id: "p-jenna",
  name: "Jenna Loeser",
  imageIds: ["i1", "i2", "i3", "i4", "i5", "i6"],
  faceCount: 6,
};

function meta(entries: Record<string, string>) {
  return new Map(
    Object.entries(entries).map(([id, f]) => [
      id,
      { parsedName: null, originalFilename: f },
    ])
  );
}
/** All images solo unless listed in `group`. */
function faceCounts(ids: string[], group: string[] = []) {
  return new Map(ids.map((id) => [id, group.includes(id) ? 3 : 1]));
}

const run = (
  persons: SuggestionPerson[],
  m: ReturnType<typeof meta>,
  fc: ReturnType<typeof faceCounts>,
  dismissed = new Set<string>()
) => computeSuggestions(persons, m, fc, extract, personLike, dismissed);

describe("sameNameFamily", () => {
  it("prefix at a word boundary is the same family", () => {
    expect(sameNameFamily("Sami Hadouaj", "Sami Hadouaj Mundra")).toBe(true);
    expect(sameNameFamily("Sami Hadouaj Mundra", "sami hadouaj")).toBe(true);
  });
  it("different names and non-boundary prefixes are not", () => {
    expect(sameNameFamily("Sami Hadouaj", "Sami Hadouajson")).toBe(false);
    expect(sameNameFamily("Katie Zeff", "Jenna Loeser")).toBe(false);
  });
});

describe("mislabels", () => {
  it("groups all photos misfiled the same way into ONE suggestion", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Katie Zeff_177.jpg",
      i6: "Katie Zeff_178.jpg",
    });
    const bigJenna = { ...jenna, imageIds: [...jenna.imageIds, "i7", "i8", "i9", "i10"] };
    const m2 = new Map([
      ...m,
      ...meta({ i7: "Jenna Loeser_7.jpg", i8: "Jenna Loeser_8.jpg", i9: "Jenna Loeser_9.jpg", i10: "Jenna Loeser_10.jpg" }),
    ]);
    const { mislabels } = run([bigJenna], m2, faceCounts(bigJenna.imageIds));
    expect(mislabels).toHaveLength(1);
    expect(mislabels[0].imageIds.sort()).toEqual(["i5", "i6"]);
    expect(mislabels[0].filedAs).toBe("Katie Zeff");
  });

  it("GROUP PHOTOS are never rename candidates (the Jenny/Sally ping-pong)", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Jenna Loeser_5.jpg",
      i6: "Sally Smith_group.jpg", // group shot filed under Sally
    });
    const { mislabels } = run([jenna], m, faceCounts(jenna.imageIds, ["i6"]));
    expect(mislabels).toHaveLength(0);
  });

  it("name-family variants are agreement, not conflict (the Sami case)", () => {
    const sami: SuggestionPerson = {
      id: "p-sami",
      name: "Sami Hadouaj",
      imageIds: ["s1", "s2", "s3", "s4"],
      faceCount: 4,
    };
    const m = meta({
      s1: "Sami Hadouaj_1.jpg",
      s2: "Sami Hadouaj_2.jpg",
      s3: "Sami Hadouaj Mundra_3.jpg",
      s4: "Sami Hadouaj Mundra_4.jpg",
    });
    const { mislabels, refinements } = run([sami], m, faceCounts(sami.imageIds));
    expect(mislabels).toHaveLength(0);
    expect(refinements).toHaveLength(1);
    expect(refinements[0]).toMatchObject({
      currentName: "Sami Hadouaj",
      fullName: "Sami Hadouaj Mundra",
      supportingCount: 2,
    });
  });

  it("a single fuller-name file is not enough for a refinement", () => {
    const sami: SuggestionPerson = {
      id: "p-sami",
      name: "Sami Hadouaj",
      imageIds: ["s1", "s2"],
      faceCount: 2,
    };
    const m = meta({ s1: "Sami Hadouaj_1.jpg", s2: "Sami Hadouaj Mundra_2.jpg" });
    const { refinements } = run([sami], m, faceCounts(sami.imageIds));
    expect(refinements).toHaveLength(0);
  });

  it("majority disagreement suppresses (the cluster name is the suspect)", () => {
    const m = meta({
      i1: "Katie Zeff_1.jpg",
      i2: "Katie Zeff_2.jpg",
      i3: "Katie Zeff_3.jpg",
      i4: "Katie Zeff_4.jpg",
      i5: "Katie Zeff_5.jpg",
      i6: "Jenna Loeser_6.jpg",
    });
    const { mislabels } = run([jenna], m, faceCounts(jenna.imageIds));
    expect(mislabels).toHaveLength(0);
  });

  it("dismissal keys cover the whole group", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Jenna Loeser_5.jpg",
      i6: "Katie Zeff_177.jpg",
    });
    const { mislabels } = run(
      [jenna],
      m,
      faceCounts(jenna.imageIds),
      new Set(["mislabel:p-jenna:katie zeff"])
    );
    expect(mislabels).toHaveLength(0);
  });
});

describe("merges", () => {
  it("suggests merging same-named fragments, smaller into larger", () => {
    const big = { id: "p1", name: "Katie Zeff", imageIds: [], faceCount: 20 };
    const small = { id: "p2", name: "katie zeff", imageIds: [], faceCount: 2 };
    const { merges } = run([big, small], new Map(), new Map());
    expect(merges).toHaveLength(1);
    expect(merges[0]).toMatchObject({ fromId: "p2", intoId: "p1" });
  });
});

describe("splits", () => {
  it("two strong filename camps yield a split card and suppress mislabels", () => {
    const cluster: SuggestionPerson = {
      id: "p-merged",
      name: "Abhudaya Shrivastava",
      imageIds: ["a1", "a2", "a3", "a4", "b1", "b2", "b3"],
      faceCount: 7,
    };
    const m = meta({
      a1: "Abhudaya Shrivastava_1.jpg",
      a2: "Abhudaya Shrivastava_2.jpg",
      a3: "Abhudaya Shrivastava_3.jpg",
      a4: "Abhudaya Shrivastava_4.jpg",
      b1: "Anth Srinivas_1.jpg",
      b2: "Anth Srinivas_2.jpg",
      b3: "Anth Srinivas_3.jpg",
    });
    const { splits, mislabels } = run([cluster], m, faceCounts(cluster.imageIds));
    expect(splits).toHaveLength(1);
    expect(splits[0].groups.map((g) => g.count)).toEqual([4, 3]);
    expect(mislabels).toHaveLength(0);
  });

  it("an unnamed cluster gets a split card too (the consensus-blocked case)", () => {
    const cluster: SuggestionPerson = {
      id: "p-anon",
      name: null,
      imageIds: ["a1", "a2", "a3", "b1", "b2", "b3"],
      faceCount: 6,
    };
    const m = meta({
      a1: "Alice Smith_1.jpg",
      a2: "Alice Smith_2.jpg",
      a3: "Alice Smith_3.jpg",
      b1: "Bella Jones_1.jpg",
      b2: "Bella Jones_2.jpg",
      b3: "Bella Jones_3.jpg",
    });
    const { splits } = run([cluster], m, faceCounts(cluster.imageIds));
    expect(splits).toHaveLength(1);
    expect(splits[0].personName).toBeNull();
  });

  it("a lone mislabel is not a split (below camp support)", () => {
    const m = meta({
      i1: "Jenna Loeser_1.jpg",
      i2: "Jenna Loeser_2.jpg",
      i3: "Jenna Loeser_3.jpg",
      i4: "Jenna Loeser_4.jpg",
      i5: "Jenna Loeser_5.jpg",
      i6: "Katie Zeff_177.jpg",
    });
    const { splits, mislabels } = run([jenna], m, faceCounts(jenna.imageIds));
    expect(splits).toHaveLength(0);
    expect(mislabels).toHaveLength(1);
  });
});

describe("group-shot immunity (2026-08-21)", () => {
  it("a split is never seeded from group frames — 'Justin Group' files are not a second person", () => {
    const justin: SuggestionPerson = {
      id: "p-justin",
      name: "Justin Vittitoe",
      imageIds: ["s1", "s2", "s3", "s4", "g1", "g2", "g3", "g4"],
      faceCount: 8,
    };
    const m = meta({
      s1: "Justin Vittitoe_001.jpg",
      s2: "Justin Vittitoe_002.jpg",
      s3: "Justin Vittitoe_003.jpg",
      s4: "Justin Vittitoe_004.jpg",
      g1: "Justin Group_021.jpg",
      g2: "Justin Group_022.jpg",
      g3: "Justin Group_023.jpg",
      g4: "Justin Group_024.jpg",
    });
    // Counting every frame, this is a 4/4 split; counting solo frames, it is not.
    expect(run([justin], m, faceCounts(justin.imageIds)).splits).toHaveLength(1);
    expect(
      run([justin], m, faceCounts(justin.imageIds, ["g1", "g2", "g3", "g4"])).splits
    ).toHaveLength(0);
  });

  it("two same-name clusters that share a frame are not offered a merge (the dog)", () => {
    const kaitlin: SuggestionPerson = {
      id: "p-k",
      name: "Kaitlin Kinzer",
      imageIds: ["k1", "k2", "k3", "d1", "d2"],
      faceCount: 5,
    };
    const dog: SuggestionPerson = {
      id: "p-dog",
      name: "Kaitlin Kinzer",
      imageIds: ["d1", "d2"],
      faceCount: 2,
    };
    const twin: SuggestionPerson = {
      id: "p-twin",
      name: "Kaitlin Kinzer",
      imageIds: ["t1", "t2"],
      faceCount: 2,
    };
    const m = meta({
      k1: "Kaitlin Kinzer_1.jpg", k2: "Kaitlin Kinzer_2.jpg", k3: "Kaitlin Kinzer_3.jpg",
      d1: "Kaitlin Kinzer_4.jpg", d2: "Kaitlin Kinzer_5.jpg",
      t1: "Kaitlin Kinzer_6.jpg", t2: "Kaitlin Kinzer_7.jpg",
    });
    const { merges } = run([kaitlin, dog, twin], m, faceCounts(["k1","k2","k3","d1","d2","t1","t2"], ["d1","d2"]));
    expect(merges.map((s) => s.fromId)).toEqual(["p-twin"]);
  });
});
