/**
 * Names are Unicode. Until 2026-09-11 every name rule assumed ASCII, and
 * every accented person in the archive was silently missing from /people.
 * The names below are real — each one was absent from the wall that day.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { nameIsRejected } from "@/lib/faces/cluster-event";
import { buildStacks, extractPersonName, personNameFromParts } from "@/lib/gallery/stacks";
import { isPersonLike } from "@/lib/sections/auto-plan";
import { parseFilename } from "@/lib/upload/parse-filename";

import { looksLikeSingleName } from "./event-labels";
import {
  looksLikePersonName,
  normalizeNameKey,
  personKeyForImage,
  preferredSpelling,
} from "./index-people";
import { asciiLetterRuns, foldName, nameText, splitCamel, UNDECOMPOSED_FOLDS } from "./name-text";

const REAL = [
  "Cassandra Córdova", "Stephan Wächter", "Alëna Aksënova", "Tiffany Bolaños",
  "Nicholas Muñoz", "Joslyn Barragán", "Gabriella Colón", "Tri Nguyễn",
  "Débora Bins", "Taís Sales", "Laura Guillén Umaña", "Marek Potočiar",
  "Armando Nájera", "Hervé Long", "Florian Dubès", "Rodrigo Bretón",
];

/** How a Mac export often writes the same name: letter + combining mark. */
const nfd = (s: string) => s.normalize("NFD");
/** The same name typed without the accent key. */
const plain = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");

/** What the /people index does with one photo: parse, then derive the name. */
const wallName = (filename: string) =>
  personNameFromParts(parseFilename(filename).name, filename);

describe("the missing people reach the wall", () => {
  it("derives each real filename to the right name, and admits it", () => {
    const cases: [string, string][] = [
      ["CassandraCórdova_26-04-14_CollegeBoard_0945.jpg", "Cassandra Córdova"],
      ["StephanWächter_26-04-30_Stripe_1101.jpg", "Stephan Wächter"],
      ["AlënaAksënova_26-04-30_Stripe_Booth1_6648.jpg", "Alëna Aksënova"],
      ["TiffanyBolaños_26-04-30_Stripe_2210.jpg", "Tiffany Bolaños"],
      ["NicholasMuñoz_26-04-14_CollegeBoard_0712.jpg", "Nicholas Muñoz"],
      ["JoslynBarragán_26-04-14_CollegeBoard_0331.jpg", "Joslyn Barragán"],
      ["GabriellaColón_26-04-14_CollegeBoard_0450.jpg", "Gabriella Colón"],
      // The old camel split could not see the boundary after "í" at all.
      ["TaísSales_26-05-06_Atlassian_0101.jpg", "Taís Sales"],
      // Decomposed on disk; derived as the composed spelling.
      [nfd("sebastián ibacache_26-05-06_Atlassian_0202.jpg"), "sebastián ibacache"],
    ];
    for (const [filename, expected] of cases) {
      const name = wallName(filename);
      expect(name, filename).toBe(expected);
      expect(looksLikePersonName(name), name).toBe(true);
    }
  });

  it("drops the stray symbol some exports put in front of a name", () => {
    expect(wallName("✓ClaraHowell_26-04-14_CollegeBoard_0010.jpg")).toBe("Clara Howell");
    expect(extractPersonName("￼EdJackson_26-04-14_CollegeBoard_1.jpg")).toBe("Ed Jackson");
  });
});

describe("looksLikePersonName", () => {
  it("accepts accented names, composed or decomposed", () => {
    for (const n of [...REAL, ...REAL.map(nfd), "Brendan O’Gibney", "José García-Márquez"]) {
      expect(looksLikePersonName(n), n).toBe(true);
    }
  });

  it("still rejects what it existed to reject", () => {
    for (const n of ["Stripe Booth1", "IMG_4532", "Tiffany Bolaños2", "©DCP", "Córdova"]) {
      expect(looksLikePersonName(n), n).toBe(false);
    }
  });
});

describe("looksLikeSingleName", () => {
  it("admits accented single names and still refuses shouting and digits", () => {
    for (const n of ["Zoë", "Noël", "Łukasz", nfd("Ségolène")]) expect(looksLikeSingleName(n), n).toBe(true);
    for (const n of ["ÉMILE", "Zoë2", "Highlights"]) expect(looksLikeSingleName(n), n).toBe(false);
  });
});

describe("normalizeNameKey", () => {
  it("is one person whatever the encoding or the accent", () => {
    for (const n of REAL) {
      expect(normalizeNameKey(nfd(n)), n).toBe(normalizeNameKey(n));
      expect(normalizeNameKey(plain(n)), n).toBe(normalizeNameKey(n));
    }
    expect(normalizeNameKey("RodrigoBretón")).toBe(normalizeNameKey("Rodrigo Breton"));
  });

  it("folds the letters NFKD leaves whole", () => {
    expect(normalizeNameKey("Søren Ærø")).toBe("sorenaero");
    expect(normalizeNameKey("Łukasz Wałęsa")).toBe("lukaszwalesa");
    expect(normalizeNameKey("Straße")).toBe("strasse");
    expect(normalizeNameKey("İlkay Gündoğan")).toBe("ilkaygundogan");
  });

  it("is byte-identical to the old rule for every plain-ASCII name", () => {
    for (const n of ["Brittany Reed", "O'Neil Smith", "AaronCote Appfolio", "WEKA sko-27", "Jo-Ann  de Vries"]) {
      expect(normalizeNameKey(n), n).toBe(n.toLowerCase().replace(/[^a-z]/g, ""));
    }
  });

  it("keeps keys to a–z — face-split's '|' separator relies on it", () => {
    for (const n of [...REAL, ...REAL.map(nfd), "Tri Nguyễn", "Алёна Аксёнова"]) {
      expect(normalizeNameKey(n), n).toMatch(/^[a-z]*$/);
    }
    // A name with no Latin letters keys to nothing and stays off the wall,
    // as before — none exist in the archive (measured 2026-09-11).
    expect(normalizeNameKey("Алёна Аксёнова")).toBe("");
  });

  it("keeps different people apart", () => {
    expect(normalizeNameKey("José Peña")).not.toBe(normalizeNameKey("José Piña"));
  });
});

describe("personKeyForImage", () => {
  it("files the composed, decomposed and accent-free exports under one key", () => {
    const keys = [
      "CassandraCórdova_26-04-14_CollegeBoard_0945.jpg",
      nfd("CassandraCórdova_26-04-14_CollegeBoard_0946.jpg"),
      "CassandraCordova_26-04-14_CollegeBoard_0947.jpg",
    ].map((f) => personKeyForImage(parseFilename(f).name, f));
    expect(new Set(keys).size).toBe(1);
  });
});

describe("preferredSpelling", () => {
  it("shows the accented spelling — an export can lose an accent, never invent one", () => {
    expect(preferredSpelling("Rodrigo Breton", "Rodrigo Bretón")).toBe("Rodrigo Bretón");
    expect(preferredSpelling("Rodrigo Bretón", "Rodrigo Breton")).toBe("Rodrigo Bretón");
  });

  it("answers in composed form", () => {
    expect(preferredSpelling(nfd("Débora Bins"), "debora bins")).toBe("Débora Bins");
  });
});

describe("asciiLetterRuns — the spotlight's search token", () => {
  it("never searches for a word with its accent cut out of the middle", () => {
    expect(asciiLetterRuns("Córdova")).toEqual(["rdova", "C"]);
    expect(asciiLetterRuns("Molly O’Neill")[0]).toBe("Molly");
  });

  it("finds every encoding of the spelling it came from", () => {
    // ilike is case-insensitive, so compare lowercased.
    for (const n of [...REAL, "Molly O’Neill", "Brendan O’Gibney"]) {
      const token = asciiLetterRuns(n)[0].toLowerCase();
      for (const s of [n, nfd(n), plain(n)]) expect(s.toLowerCase(), `${n} → ${token}`).toContain(token);
    }
  });
});

describe("name-text helpers", () => {
  it("nameText composes and strips stray leading symbols", () => {
    expect(nameText(nfd("Córdova"))).toBe("Córdova");
    expect(nameText("✓ClaraHowell")).toBe("ClaraHowell");
    expect(nameText("￼EdJackson")).toBe("EdJackson");
  });

  it("splitCamel sees the boundary after an accented letter, marks and all", () => {
    expect(splitCamel("TaísSales")).toBe("Taís Sales");
    expect(splitCamel(nfd("TaísSales"))).toBe(nfd("Taís Sales"));
    expect(splitCamel("BrendanO’Gibney")).toBe("Brendan O’Gibney");
  });

  it("foldName keeps word boundaries", () => {
    expect(foldName("Nájera-Smith")).toBe("najera-smith");
  });
});

describe("the other name heuristics", () => {
  it("parseFilename reads accented CamelCase and stores the composed name", () => {
    expect(parseFilename("CórdovaCassandra_001.jpg").name).toBe("Córdova, Cassandra");
    expect(parseFilename(nfd("Débora Bins-001.jpg")).name).toBe("Débora Bins");
  });

  it("isPersonLike (auto-sections, stacks, the cluster namer) admits accents", () => {
    for (const n of ["José García", "Zoë Smith", nfd("Débora Bins"), "Stephanie D’Angelo"]) {
      expect(isPersonLike(n), n).toBe(true);
    }
    expect(isPersonLike("Cher")).toBe(false);
  });

  it("nameIsRejected holds across accents", () => {
    expect(nameIsRejected("Armando Najera", ["Armando Nájera"])).toBe(true);
    expect(nameIsRejected(nfd("Armando Nájera"), ["armando najera"])).toBe(true);
  });

  it("one stack for one person, however each file spells them", () => {
    const stacks = buildStacks(
      [
        "RodrigoBretón_26-04-30_Stripe_0001.jpg",
        "RodrigoBreton_26-04-30_Stripe_0002.jpg",
        nfd("RodrigoBretón_26-04-30_Stripe_0003.jpg"),
      ].map((f) => ({ parsedName: parseFilename(f).name, originalFilename: f }))
    );
    expect(stacks).toHaveLength(1);
    expect(stacks[0].personName).toBe("Rodrigo Bretón");
  });
});

describe("the SQL twin (migration 081)", () => {
  it("folds with exactly the TypeScript table", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/081_person_name_key.sql"),
      "utf8"
    );
    const tr = sql.match(/translate\(normalize\(p, NFKD\), '([^']+)', '([^']+)'\)/u);
    expect(tr).not.toBeNull();
    const from = [...tr![1]];
    const to = [...tr![2]];
    // translate() pairs by position and drops extras silently — the one slip
    // real names would never reveal.
    expect(to.length).toBe(from.length);
    const table: Record<string, string> = {};
    from.forEach((c, i) => (table[c] = to[i]));
    for (const m of sql.matchAll(/'(\S)', '([a-z]{2})'\)/gu)) table[m[1]] = m[2];
    expect(table).toEqual(UNDECOMPOSED_FOLDS);
  });
});
