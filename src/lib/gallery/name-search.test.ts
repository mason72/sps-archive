import { describe, expect, it } from "vitest";
import { editDistance, nameDistance, searchByName, type NameFields } from "./name-search";

// Real names from Money 2020 USA (2026-10-18), as guests typed them at the
// booth, plus a few added to exercise one rule each (noted inline).
const NAMES = [
  "AARON Arter", "ADIL mirza", "AINSLEY JOHSNTON", "Alex Budt", "alex servin",
  "Batya Castro", "carol grunberg", "Daniel Offenbacher", "Emily", "eric park",
  "Jennifer McQuilkin", "joe hurley", "Kelley Andersen", "Kelsey Clark",
  "MIKE DORAN", "ming cheng", "Nicole Clarke", "nicole maio", "Nicole Tevere",
  "Shelby Nucera", "stacy chen", "teri wagner", "yi zhang", "José García",
  "Kay Anderson", // two edits from "andersenn", Kelley Andersen one: the closest-tier rule
  "Catherine Lee", // C/K first-letter exception
  "Christopher Wolf", // the word still being typed
  "王伟", "Иван Петров", "김민수", // non-Latin names
  "Jon Smith", "Erik Lee", // a short word's typo inside a phrase
  "Lisa O'Brien", "Mary-Ann Lopez", "Juan De La Cruz", // punctuation and spacing
  "Joe Neil", // holds an "o" and the word "neil", but is not O'Neil
  "Raymond Lang", // lang + raymond (name, then filename) spells "…langraymond…"
  "Harold Bowman", "Angela Costa", // "old" + "man" and "a" + "costa" sit inside
  "Ben Chen", // Ben + Chen starts with "bench"
  "Ana Delacruz", // stored joined, typed spaced
  "Mary Prince", // two edits from "princess", which is only 8 letters
  // Surnames that the first version matched from common visual words.
  "Jack Bauer", "Kenneth Gordon", "Mary Good", "Tyler Baker", "Caleb Potts",
  "Ann Booth", "Joe Smith", "Ruth Hall", "Dawn Leach", "Logan Tanner",
  "Luke Cardenas", "Jonathan Ward", "Eric Harrington", "Heather Mosley",
];

// Three frames per person, filenames shaped like the SPS booth's.
const IMAGES: (NameFields & { id: string })[] = NAMES.flatMap((n, i) =>
  [0, 1, 2].map((k) => ({
    id: `${i}-${k}`,
    parsedName: n,
    originalFilename: `${n}_26-10-20_${1000 + i * 10 + k}.jpg`,
  }))
);

const search = (q: string) => searchByName(IMAGES, q, (img) => img);

describe("editDistance", () => {
  it("counts a swapped pair of letters as one edit", () => {
    expect(editDistance("johsnton", "johnston", 2)).toBe(1);
  });
  it("counts an insertion as one edit", () => {
    expect(editDistance("stacey", "stacy", 2)).toBe(1);
  });
  it("stops early above the limit", () => {
    expect(editDistance("abcdef", "uvwxyz", 1)).toBe(2);
  });
});

describe("exact tier", () => {
  it("finds the stored spelling", () => {
    const r = search("stacy");
    expect(r.kind).toBe("exact");
    expect(r.items).toHaveLength(3);
  });

  it("keeps the old prefix behavior", () => {
    expect(search("stac").kind).toBe("exact");
  });

  it("matches a frame number in the filename", () => {
    const r = search("1222");
    expect(r.kind).toBe("exact");
    expect(r.items.map((i) => i.id)).toEqual(["22-2"]);
  });

  it("does not depend on word order", () => {
    expect(search("chen stacy").kind).toBe("exact");
  });

  it("folds accents", () => {
    expect(search("jose garcia").items).toHaveLength(3);
  });

  it("does not glue a date onto a frame number", () => {
    // "…_26-10-20_1020.jpg" with separators dropped holds "1020" in every photo.
    const old = (q: string) => IMAGES.filter((img) => img.originalFilename!.includes(q));
    for (const q of ["1020", "2610", "2010", "201"]) {
      expect(search(q).items, q).toEqual(old(q));
    }
  });

  it("does not glue one field or word onto the next", () => {
    expect(search("gray").kind).toBe("none"); // Raymond Lang: lang|raymond
    expect(search("acosta").kind).toBe("none"); // Angela Costa
  });

  it("needs each word of a phrase to start a name word", () => {
    expect(search("old man").kind).not.toBe("exact"); // Harold Bowman
  });

  it("(a) keeps the old substring rule for a phrase and for punctuation", () => {
    expect(search("acy ch").suggestions).toEqual([]);
    expect(search("acy ch").items.map((i) => i.parsedName)).toEqual([
      "stacy chen", "stacy chen", "stacy chen",
    ]);
    expect(search("_").items).toHaveLength(IMAGES.length);
  });

  it("(b) finds a one-word name form with punctuation dropped", () => {
    expect(search("obrien").kind).toBe("exact");
    expect(search("maryann").kind).toBe("exact");
  });

  it("does not take a join that ends inside a word", () => {
    expect(search("bench").kind).not.toBe("exact"); // Ben + Ch…en
  });

  it("leaves a half-typed joined word to the fuzzy tier", () => {
    expect(search("obri").suggestions).toEqual(["Lisa O'Brien"]);
  });

  it("does not let a short number in a phrase match the date", () => {
    expect(search("park 2").kind).toBe("none");
    expect(search("stacy 1201").items.map((i) => i.id)).toEqual(["20-1"]); // a frame number still does
  });

  it("finds a name stored joined and typed with spaces", () => {
    expect(search("de la cruz").items.some((i) => i.parsedName === "Ana Delacruz")).toBe(true);
  });

  it("ignores punctuation and spacing inside a name", () => {
    expect(search("lisa obrien").kind).toBe("exact");
    expect(search("o'brien").kind).toBe("exact");
    expect(search("maryann lopez").kind).toBe("exact");
    expect(search("juan delacruz").kind).toBe("exact");
  });

  it("does not split a typed apostrophe into a lone letter", () => {
    // "o'neil" must not become "o" + "neil", which would match any photo
    // holding the letter o and the word neil.
    const r = search("o'neil");
    expect(r.items.some((i) => i.parsedName === "Joe Neil")).toBe(false);
  });

  it("folds full-width letters", () => {
    expect(search("ＳＴＡＣＹ").kind).toBe("exact");
  });

  it("finds names in any script", () => {
    expect(search("王伟").items).toHaveLength(3);
    expect(search("иван").items).toHaveLength(3);
    expect(search("Иван Петров").kind).toBe("exact");
  });

  it("finds everything the old substring rule found, for any single word", () => {
    const old = (q: string) =>
      IMAGES.filter(
        (img) =>
          img.parsedName!.toLowerCase().includes(q) ||
          img.originalFilename!.toLowerCase().includes(q)
      );
    for (const q of ["nic", "nicole", "chen", "clark", "26", "jpg", "ar", "mike", "王", "пет"]) {
      const r = search(q);
      expect(r.kind, q).toBe("exact");
      // A superset: the punctuation-free comparison may add a match.
      const got = new Set(r.items);
      for (const img of old(q)) expect(got.has(img), `${q} ${img.id}`).toBe(true);
    }
  });
});

describe("fuzzy tier", () => {
  it("finds Stacy Chen when the client types Stacey (the reported case)", () => {
    for (const q of ["stacey", "Stacey", "stace", "stacey chen", "Stacey Chen", "stacey c"]) {
      const r = search(q);
      expect(r.kind, q).toBe("fuzzy");
      expect(r.suggestions, q).toEqual(["Stacy Chen"]);
      expect(r.items, q).toHaveLength(3);
    }
  });

  it("finds a guest who swapped two letters of their own name", () => {
    const r = search("ainsley johnston");
    expect(r.kind).toBe("fuzzy");
    expect(r.suggestions).toEqual(["Ainsley Johsnton"]);
  });

  it("allows two edits at 9+ letters but one at 5–8", () => {
    expect(editDistance("offenbaker", "offenbacher", 2)).toBe(2);
    expect(search("offenbaker").suggestions).toEqual(["Daniel Offenbacher"]);
    expect(search("grunbeg").suggestions).toEqual(["Carol Grunberg"]); // 7 letters, 1 edit
    expect(editDistance("grnbeg", "grunberg", 2)).toBe(2);
    expect(search("grnbeg").kind).toBe("none"); // 6 letters, 2 edits
    expect(editDistance("princess", "prince", 2)).toBe(2);
    expect(search("princess").kind).toBe("none"); // 8 letters, 2 edits
  });

  it("forgives a short word's typo inside a phrase", () => {
    expect(search("stacy chan").suggestions).toEqual(["Stacy Chen"]);
    expect(search("stacey chan").suggestions).toEqual(["Stacy Chen"]);
    expect(search("john smith").suggestions).toEqual(["Jon Smith"]);
    expect(search("eric lee").suggestions).toEqual(["Erik Lee"]);
  });

  it("matches neighbouring name words joined", () => {
    expect(search("juan delakruz").suggestions).toEqual(["Juan De La Cruz"]);
    expect(search("lisa obrian").suggestions).toEqual(["Lisa O'Brien"]);
  });

  it("never fuzzes a non-Latin word", () => {
    // NFD splits each Hangul syllable into its letters (jamo), so these are
    // 8 "letters" one apart: a letter-by-letter match would call 김민주 김민수.
    expect(search("김민주").kind).toBe("none");
  });

  it("keeps only the closest tier", () => {
    // Both are within reach of a 9-letter word; only the closer one is kept.
    expect(nameDistance(["andersenn"], "Kelley Andersen")).toBe(1);
    expect(nameDistance(["andersenn"], "Kay Anderson")).toBe(2);
    expect(search("andersenn").suggestions).toEqual(["Kelley Andersen"]);
  });

  it("lists every person tied for closest", () => {
    // "nicola" is one edit from all three Nicoles.
    const r = search("nicola");
    expect(r.kind).toBe("fuzzy");
    expect(r.suggestions.sort()).toEqual(["Nicole Clarke", "Nicole Maio", "Nicole Tevere"]);
  });

  it("keeps the first letter, except C and K", () => {
    expect(search("katherine").suggestions).toEqual(["Catherine Lee"]);
    expect(search("beach").kind).toBe("none"); // not Dawn Leach
  });

  it("compares the word being typed against the start of a longer name", () => {
    expect(search("chirstoph").suggestions).toEqual(["Christopher Wolf"]);
    // An earlier, finished word is judged whole: three edits from "christopher".
    expect(search("chirstoph wolf").kind).toBe("none");
  });

  it("requires every word to match", () => {
    expect(search("stacey zzzzzz").kind).toBe("none");
  });

  it("never fuzzes a word of four letters or fewer", () => {
    expect(search("yo").kind).toBe("none");
    expect(search("jim").kind).toBe("none");
    expect(search("gold").kind).toBe("none"); // one edit from Good and Gordon's start
  });

  it("does not turn common visual searches into names", () => {
    // Each of these matched a stranger in the first version, on a
    // 1,000-person test gallery (review of 2026-10-26).
    for (const q of [
      "blue", "gold", "cake", "tall", "band", "hair", "grey", "gray", "mask",
      "logo", "food", "dance", "wave", "chef", "boat", "bike", "suit", "beach",
      "award", "leather", "earrings", "banner", "garden", "glasses", "smiling",
      "group", "stage", "blue shirt", "red dress", "laughing", "two people",
    ]) {
      const r = search(q);
      expect(r.kind, q).not.toBe("fuzzy");
      // An exact hit is allowed only where the old substring rule had one: a
      // NEW exact hit hides the AI search entirely, which is worse.
      if (r.kind === "exact") {
        const old = IMAGES.filter(
          (img) =>
            img.parsedName!.toLowerCase().includes(q) ||
            img.originalFilename!.toLowerCase().includes(q)
        );
        expect(r.items, q).toEqual(old);
      }
    }
  });

  it("does not read digits in a name as name words", () => {
    // Without the letters-only filter, "24091" is one edit from "24090".
    expect(nameDistance(["24091"], "Stacy 24090")).toBeNull();
  });
});

describe("derived-name cache", () => {
  it("derives again when a photo is renamed in place", () => {
    const img = { parsedName: "stacy chen", originalFilename: "stacy chen_26-10-20_1.jpg" };
    expect(searchByName([img], "stacey", (i) => i).suggestions).toEqual(["Stacy Chen"]);
    img.parsedName = "tracy chen";
    img.originalFilename = "tracy chen_26-10-20_1.jpg";
    expect(searchByName([img], "tracey", (i) => i).suggestions).toEqual(["Tracy Chen"]);
  });
});
