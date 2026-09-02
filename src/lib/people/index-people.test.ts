import { describe, it, expect } from "vitest";
import {
  displayName,
  looksLikePersonName,
  normalizeNameKey,
  personKeyForImage,
  preferredSpelling,
} from "./index-people";

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

describe("personKeyForImage", () => {
  it("matches the name on a /people tile to the photos in its event", () => {
    // The real HDC filenames behind the "77 photos, opened to nothing" bug.
    const files = [
      "Jeff Roark_26-08-06_HDC_3182.jpg",
      "Jeff Roark_26-08-06_HDC_3183.jpg",
    ];
    const key = normalizeNameKey("Jeff Roark");
    for (const f of files) {
      expect(personKeyForImage(null, f), f).toBe(key);
    }
  });

  it("agrees with itself across parsed_name and filename sources", () => {
    // parsed_name present vs absent must land on the same person, or the
    // spotlight's count and the event's filter disagree.
    expect(personKeyForImage("Aleta Cruel", "Aleta Cruel_26-03-02_CB_0912.jpg")).toBe(
      personKeyForImage(null, "Aleta Cruel_26-03-02_CB_0912.jpg")
    );
  });

  it("is raw identity, NOT a personhood test — the guard is separate", () => {
    // A camera code still yields a key ("img"), so any caller taking a name
    // from OUTSIDE the index (a ?person= URL) must run looksLikePersonName
    // first, or "?person=IMG" would filter an event to every IMG_ file.
    expect(personKeyForImage(null, "IMG_4532.jpg")).toBe("img");
    expect(looksLikePersonName("IMG_4532")).toBe(false);
  });
});

describe("preferredSpelling", () => {
  it("prefers the person-like spelling over the run-together blob", () => {
    // Brittany Reed's two Appfolio shoots: "Brittany Reed_26-08-05_..." and
    // "brittanyreed_26-07-14_...". Same person, same key, one readable label.
    expect(preferredSpelling("brittanyreed", "Brittany Reed")).toBe("Brittany Reed");
    expect(preferredSpelling("Brittany Reed", "brittanyreed")).toBe("Brittany Reed");
  });

  it("falls back to the longer spelling when both are person-like", () => {
    expect(preferredSpelling("Anne Brown", "Anne Elise Brown")).toBe("Anne Elise Brown");
  });

  it("prefers a clean single name over its digit-suffixed spelling", () => {
    expect(preferredSpelling("Twitch3", "Twitch")).toBe("Twitch");
    expect(preferredSpelling("Nachi", "Nachi2")).toBe("Nachi");
  });

  it("is order-independent", () => {
    expect(preferredSpelling("aaroncote", "Aaron Cote")).toBe(
      preferredSpelling("Aaron Cote", "aaroncote")
    );
  });
});
