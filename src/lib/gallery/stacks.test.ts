import { describe, it, expect } from "vitest";
import {
  collapseRepeatedWords,
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

describe("collapseRepeatedWords (2026-08-21)", () => {
  it("a back-to-back repeated word is a typo, not a name", () => {
    expect(extractPersonName("Tori Marifian Marifian_26-08-19_Appfolio_699.jpg")).toBe(
      "Tori Marifian"
    );
    expect(nameBeforeDate("Tori Marifian Marifian_26-08-19_Appfolio_699.jpg")).toBe(
      "Tori Marifian"
    );
    expect(collapseRepeatedWords("Ann ann Lee")).toBe("Ann Lee");
  });
  it("a legitimately repeated name survives when the words are not adjacent", () => {
    expect(collapseRepeatedWords("Jean Luc Jean")).toBe("Jean Luc Jean");
  });
});

describe("splitPersonWords (lesson 147)", () => {
  it("keeps a doubled first name typed fused, and drops the tag after the date", () => {
    // Both people used to key with their event tag: the collapse read the
    // doubled first name as a typo, so the date-anchored name no longer
    // matched the parsed one and the tag survived.
    expect(nameBeforeDate("DeeDeeAcquista_26-03-23_DTEX_March_2026_0213.jpg")).toBe("Dee Dee Acquista");
    expect(nameBeforeDate("SinhSinh An_26-07-02_gels_0689.jpg")).toBe("Sinh Sinh An");
    expect(
      personNameFromParts("DeeDeeAcquista DTEX March", "DeeDeeAcquista_26-03-23_DTEX_March_2026_0213.jpg")
    ).toBe("Dee Dee Acquista");
    expect(personNameFromParts("SinhSinh An gels", "SinhSinh An_26-07-02_gels_0689.jpg")).toBe("Sinh Sinh An");
  });

  it("still collapses the typos the rule exists for", () => {
    expect(nameBeforeDate("IreneGonzalezGonzalez_26-07-14_Appfolio_061.jpg")).toBe("Irene Gonzalez");
    expect(nameBeforeDate("LauraLaura_26-07-23_APAC_BLUE_1023.jpg")).toBe("Laura");
    expect(nameBeforeDate("wahab wahab_26-06-17_DAIS_9348.jpg")).toBe("wahab");
  });

  it("reads particles and initials as the wall should show them", () => {
    expect(nameBeforeDate("CarlyMcNeil_251217_CoStarGroup_Arlington_296.jpg")).toBe("Carly McNeil");
    expect(nameBeforeDate("BrookeQ.McElwee_26-01-27_1.jpg")).toBe("Brooke Q. McElwee");
    expect(nameBeforeDate("KevinTKing_26-01-27_ALIS2026_2890.jpg")).toBe("Kevin T King");
    // A lone O or D is a dropped apostrophe, not an initial.
    expect(nameBeforeDate("RyanONeil_26-02-11_IslandSKO_2002.jpg")).toBe("Ryan ONeil");
    expect(nameBeforeDate("KevinDSilva_26-01-22_ServiceNowBooth2_7756.jpg")).toBe("Kevin DSilva");
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

  it("drops the comma the parser guessed into a fused name (lesson 140)", () => {
    // parse-filename turns "KellyBottarini" into "Kelly, Bottarini"; the comma
    // failed every person-shape test and kept 7,051 photos off /people.
    expect(
      stackPersonName(
        img({ parsedName: "Kelly, Bottarini", originalFilename: "KellyBottarini_063.jpg" })
      )
    ).toBe("Kelly Bottarini");
    expect(
      personNameFromParts("Joy, Andrada", "JoyAndrada_26-01-27_2646.jpg")
    ).toBe("Joy Andrada");
  });

  it("keeps a comma the filename itself carries", () => {
    expect(personNameFromParts("Smith, John", "Smith, John.jpg")).toBe("Smith, John");
  });

  it("names an undated event export from its first segment (DATADOG, lesson 140)", () => {
    expect(
      personNameFromParts(
        "AudreyEasley DataDogHeadshots NYC30119",
        "AudreyEasley_DataDogHeadshots_NYC30119.jpg"
      )
    ).toBe("Audrey Easley");
    expect(
      personNameFromParts("VictoriaO’Neill DataDogHeadshots NYC29441", "VictoriaO’Neill_DataDogHeadshots_NYC29441.jpg")
    ).toBe("Victoria O’Neill");
  });

  it("leaves an undated export unnamed when the first segment could be the tag", () => {
    // Fused tag: a wrong name is worse than a missing one.
    const fused = "JeamarieCastroDataDogHeadshots NYC28839";
    expect(personNameFromParts(fused, "JeamarieCastroDataDogHeadshots_NYC28839.jpg")).toBe(fused);
    // One word, or digits, or no name at all.
    expect(personNameFromParts("YY DataDogHeadshots NYC29991", "YY_DataDogHeadshots_NYC29991.jpg")).toBe(
      "YY DataDogHeadshots NYC29991"
    );
    expect(personNameFromParts("DataDogHeadshots NYC29800", "260127_DataDogHeadshots_NYC29800.jpg")).toBe(
      "DataDogHeadshots NYC29800"
    );
  });

  it("the undated fallback refuses shapes that are not event exports (review, 2026-09-14)", () => {
    // No frame counter: a group or brand prefix, not a person.
    expect(personNameFromParts("GroupShot A12", "GroupShot_A12.jpg")).toBe("GroupShot A12");
    expect(personNameFromParts("TeamLead B2", "TeamLead_B2.jpg")).toBe("TeamLead B2");
    // A spaced first segment may be missing its surname.
    expect(personNameFromParts("Maria Jose Garcia B1234", "Maria Jose_Garcia_B1234.jpg")).toBe(
      "Maria Jose Garcia B1234"
    );
    // An SPS AI render names the same person, not "(AI) Audrey Easley".
    expect(
      personNameFromParts(
        "AudreyEasley DataDogHeadshots NYC30119",
        "(AI) AudreyEasley_DataDogHeadshots_NYC30119.jpg"
      )
    ).toBe("Audrey Easley");
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

  /** Real production shapes. The compact date was not an anchor until
   *  2026-09-14, so the event tag after it joined the person's key. */
  it.each([
    ["PatrickStrozzo_260603_FMheadshots_0172.jpg", "Patrick Strozzo"],
    ["BrianRey_251217_CoStarGroup_Arlington_069.jpg", "Brian Rey"],
    ["JackieWaters_260225_Okta_SKOBooth226605.jpg", "Jackie Waters"],
    ["Mike_250201_GoldenGateYPO4610.jpg", "Mike"],
  ])("anchors on a compact _YYMMDD_ date: %s", (file, name) => {
    expect(nameBeforeDate(file)).toBe(name);
  });

  it.each([
    "Name_123456.jpg", // six digits with no closing underscore is a frame number
    "Jane Doe_261399_Booth_1.jpg", // month 13 is not a date
    "251209_ChimePhoto25833.jpg", // a leading date has no name before it
  ])("does not treat %s as a compact date", (file) => {
    expect(nameBeforeDate(file)).toBeNull();
  });
});

describe("stackPersonName — compact dates", () => {
  it("drops the event tag after a compact date", () => {
    expect(
      stackPersonName(
        img({
          parsedName: "PatrickStrozzo FMheadshots",
          originalFilename: "PatrickStrozzo_260603_FMheadshots_0172.jpg",
        })
      )
    ).toBe("Patrick Strozzo");
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
