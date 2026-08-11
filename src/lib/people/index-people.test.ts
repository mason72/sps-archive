import { describe, it, expect } from "vitest";
import { displayName, looksLikePersonName, normalizeNameKey } from "./index-people";

describe("looksLikePersonName", () => {
  it("accepts real two-part names", () => {
    for (const n of ["Brittany Reed", "Anne Marie Lee", "Aaron Cote", "O'Neil Smith"]) {
      expect(looksLikePersonName(n), n).toBe(true);
    }
  });

  it("rejects the venue/tag names that polluted the first leaderboard", () => {
    // These four ranked as the archive's most-photographed "people" before
    // the guard existed — all filename fragments from marketing galleries.
    for (const n of ["GitHub Universe5", "Palo Alto Networks26", "BTS CEMA24", "Catherinelentz LeviStadium"]) {
      expect(looksLikePersonName(n), n).toBe(n === "Catherinelentz LeviStadium");
    }
  });

  it("rejects camera codes and single words", () => {
    for (const n of ["IMG_4532", "DSC01234", "Highlights", "", "  "]) {
      expect(looksLikePersonName(n), n).toBe(false);
    }
  });
});

describe("normalizeNameKey", () => {
  it("collapses spelling/punctuation variants to one identity", () => {
    expect(normalizeNameKey("Brittany Reed")).toBe(normalizeNameKey("brittany  reed"));
    expect(normalizeNameKey("O'Neil Smith")).toBe(normalizeNameKey("ONeil Smith"));
  });

  it("keeps different people apart", () => {
    expect(normalizeNameKey("Jane Doe")).not.toBe(normalizeNameKey("John Doe"));
  });
});

describe("displayName", () => {
  it("title-cases shouted and lowercased filenames", () => {
    expect(displayName("andrew dorman")).toBe("Andrew Dorman");
    expect(displayName("BRITTANY REED")).toBe("Brittany Reed");
  });

  it("leaves mixed case exactly as typed — never 'corrects' a real name", () => {
    for (const n of ["Andrew McCartney", "Anne de Vries", "Renée O'Neil"]) {
      expect(displayName(n)).toBe(n);
    }
  });

  it("capitalises across hyphens and apostrophes when single-cased", () => {
    expect(displayName("anne-marie o'neil")).toBe("Anne-Marie O'Neil");
  });

  it("collapses runaway whitespace", () => {
    expect(displayName("  jane   doe ")).toBe("Jane Doe");
  });
});
