import { describe, it, expect } from "vitest";
import {
  buildNameCleaner,
  buildStacks,
  displayName,
  extractPersonName,
  nameBeforeDate,
  personNameFromParts,
  stackPersonName,
} from "./stacks";
import type { GalleryImage } from "@/types/gallery";

function img(over: Partial<GalleryImage>): GalleryImage {
  return {
    id: Math.random().toString(36).slice(2),
    originalFilename: "photo.jpg",
    parsedName: null,
    thumbnailUrl: "t",
    width: 800,
    height: 600,
    ...over,
  } as GalleryImage;
}

describe("extractPersonName", () => {
  it("splits camel-case into words", () => {
    expect(extractPersonName("JohnSmith_1234.jpg")).toBe("John Smith");
  });

  it("handles date-suffixed filenames", () => {
    expect(extractPersonName("JohnSmith_24-01-30_1234.jpg")).toBe("John Smith");
  });

  it("handles spaces and keeps the name segment", () => {
    expect(extractPersonName("Amber Artis_24-01-30_Booth_527.jpg")).toBe(
      "Amber Artis"
    );
  });

  it("falls back to first underscore segment", () => {
    expect(extractPersonName("Smith_001.jpg")).toBe("Smith");
  });

  it("handles double-dash separators", () => {
    expect(extractPersonName("Jane Doe--042.jpg")).toBe("Jane Doe");
  });
});

describe("stackPersonName", () => {
  it("trims event tokens the upload parser absorbed past the date segment", () => {
    expect(
      stackPersonName(
        img({
          parsedName: "Rushi Sheth CollegeBoardSLC",
          originalFilename: "Rushi Sheth_26-06-24_CollegeBoardSLC_1581.jpg",
        })
      )
    ).toBe("Rushi Sheth");
  });

  it("trims event tags after CamelCase names (normalized prefix — the Appfolio bug)", () => {
    expect(
      stackPersonName(
        img({
          parsedName: "AaronCote Appfolio",
          originalFilename: "AaronCote_26-07-14_Appfolio_1127.jpg",
        })
      )
    ).toBe("Aaron Cote");
  });

  it("keeps punctuated parsed names (prefix test fails on the comma)", () => {
    expect(
      stackPersonName(
        img({ parsedName: "Smith, John", originalFilename: "SmithJohn_001.jpg" })
      )
    ).toBe("Smith, John");
  });

  it("never shortens via the underscore-fallback path (no date anchor)", () => {
    expect(
      stackPersonName(
        img({ parsedName: "Smith John", originalFilename: "Smith_John_001.jpg" })
      )
    ).toBe("Smith John");
  });

  it("falls back to filename extraction without a parsed name", () => {
    expect(
      stackPersonName(img({ parsedName: null, originalFilename: "JohnSmith_002.jpg" }))
    ).toBe("John Smith");
  });
});

describe("nameBeforeDate", () => {
  it("answers only when a date/double-dash anchor exists", () => {
    expect(nameBeforeDate("Amber Artis_24-01-30_Booth_527.jpg")).toBe("Amber Artis");
    expect(nameBeforeDate("Smith_John_001.jpg")).toBeNull();
  });
});

describe("buildStacks", () => {
  it("groups by parsedName when present, case-insensitively", () => {
    const images = [
      img({ id: "a", parsedName: "Smith, John" }),
      img({ id: "b", parsedName: "smith, john" }),
      img({ id: "c", parsedName: "Jones, Amy" }),
    ];
    const stacks = buildStacks(images);
    expect(stacks).toHaveLength(2);
    expect(stacks[0].images.map((i) => i.id)).toEqual(["a", "b"]);
    expect(stacks[0].personName).toBe("Smith, John");
  });

  it("falls back to filename-derived names", () => {
    const images = [
      img({ id: "a", originalFilename: "JohnSmith_001.jpg" }),
      img({ id: "b", originalFilename: "JohnSmith_002.jpg" }),
    ];
    const stacks = buildStacks(images);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].personName).toBe("John Smith");
  });

  it("preserves first-appearance order (respects the gallery sort)", () => {
    const images = [
      img({ id: "b1", parsedName: "B" }),
      img({ id: "a1", parsedName: "A" }),
      img({ id: "b2", parsedName: "B" }),
    ];
    const stacks = buildStacks(images);
    expect(stacks.map((s) => s.personName)).toEqual(["B", "A"]);
    expect(stacks[0].images.map((i) => i.id)).toEqual(["b1", "b2"]);
  });

  it("keeps singles as one-image stacks", () => {
    const stacks = buildStacks([img({ id: "solo", parsedName: "Solo" })]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].images).toHaveLength(1);
  });
});

describe("buildNameCleaner (corpus event-tag stripping)", () => {
  const names = (n: number, tag?: string) =>
    Array.from({ length: n }, (_, i) => `Person${i} Name${i}${tag ? ` ${tag}` : ""}`);

  it("strips a token that appears in most distinct names", () => {
    const clean = buildNameCleaner(names(20, "Appfolio"));
    expect(clean("Aaron Cote Appfolio")).toBe("Aaron Cote");
    expect(clean("Aaron Cote")).toBe("Aaron Cote");
  });

  it("does nothing below the distinct-name floor (family shoots are safe)", () => {
    const clean = buildNameCleaner(names(10, "Smith"));
    expect(clean("John Smith")).toBe("John Smith");
  });

  it("does nothing when no token clears the frequency bar", () => {
    const tagged = [...names(12, "Appfolio"), ...names(12)];
    // 12 of 24 distinct names = 50% < 60% threshold.
    const clean = buildNameCleaner(tagged.map((n, i) => `${n}${i}`));
    expect(clean("Aaron Cote Appfolio")).toBe("Aaron Cote Appfolio");
  });

  it("camel-splits a fused remainder after stripping ('AaronCote' → 'Aaron Cote')", () => {
    const letters = "abcdefghijklmnopqrst".split("");
    const corpus = letters.map((l) => `A${l}ron C${l}te Appfolio`);
    const clean = buildNameCleaner(corpus);
    expect(clean("AaronCote Appfolio")).toBe("Aaron Cote");
    // Names it didn't modify are never re-split.
    expect(clean("AaronCote")).toBe("AaronCote");
  });

  it("never strips a dominant shared surname (stripping must leave a person)", () => {
    // Everyone is "<First> Doe" — 100% frequency, but removal leaves a bare
    // first name, so "Doe" must survive.
    const surnames = Array.from({ length: 20 }, (_, i) => `First${i} Doe`);
    const clean = buildNameCleaner(surnames);
    expect(clean("First3 Doe")).toBe("First3 Doe");
  });

  it("never erases a name made entirely of the tag", () => {
    const clean = buildNameCleaner([...names(20, "Appfolio"), "Appfolio"]);
    expect(clean("Appfolio")).toBe("Appfolio");
  });
});

describe("buildStacks — event-tag merging", () => {
  it("merges tagged and untagged files of one person (date-anchored names)", () => {
    // The normalized-prefix fix strips the tag; the punctuation-insensitive
    // key then unifies "Aaron Cote" with the untagged "Aaron, Cote".
    const images = [
      img({
        parsedName: "AaronCote Appfolio",
        originalFilename: "AaronCote_26-07-14_Appfolio_1127.jpg",
      }),
      img({
        parsedName: "Aaron, Cote",
        originalFilename: "AaronCote_9001.jpg",
      }),
    ];
    const stacks = buildStacks(images);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].images).toHaveLength(2);
    expect(stacks[0].personName).toBe("Aaron Cote");
  });

  it("merges via the corpus cleaner when filenames have no date anchor", () => {
    // No date segment, so the prefix guard can't fire — only frequency
    // analysis can know "Appfolio" is an event tag. 16 tagged people clear
    // the thresholds; Aaron's untagged file joins his tagged stack.
    const images = [
      ...Array.from({ length: 15 }, (_, i) =>
        img({
          parsedName: `First${i} Last${i} Appfolio`,
          originalFilename: `First${i}_Last${i}_Appfolio_1.jpg`,
        })
      ),
      img({
        parsedName: "AaronCote Appfolio",
        originalFilename: "AaronCote_Appfolio_1127.jpg",
      }),
      img({
        parsedName: "Aaron, Cote",
        originalFilename: "AaronCote_9001.jpg",
      }),
    ];
    const stacks = buildStacks(images);
    const aaron = stacks.filter((s) => s.key.includes("aaroncote"));
    expect(aaron).toHaveLength(1);
    expect(aaron[0].images).toHaveLength(2);
    expect(stacks.every((s) => !/appfolio/i.test(s.personName))).toBe(true);
  });
});

describe("stack display casing", () => {
  it("title-cases shouted and lowercased filename names", () => {
    // The HDC grid: "pablo estrada", "pete destefano", "paula weiss4end".
    expect(displayName("pete destefano")).toBe("Pete Destefano");
    expect(displayName("PABLO ESTRADA")).toBe("Pablo Estrada");
  });

  it("leaves mixed case alone — it's the only evidence of a real spelling", () => {
    for (const n of ["Pete DeStefano", "Petre Trpkovski", "Anne de Vries"]) {
      expect(displayName(n)).toBe(n);
    }
  });
});
