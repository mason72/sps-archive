import { describe, expect, it } from "vitest";

import { asciiFilePart, uniqueFolderNames } from "./file-part";

describe("uniqueFolderNames — one folder per section", () => {
  it("separates sections that fold or were named alike", () => {
    const m = uniqueFolderNames([
      { id: "a", name: "José" },
      { id: "b", name: "Jose" },
      { id: "c", name: "JOSE" },
      { id: "d", name: "Q&A: Panel" },
      { id: "e", name: "QA Panel" },
      { id: "f", name: "Highlights" },
    ]);
    expect([...m.values()]).toEqual(["Jose", "Jose-2", "JOSE-3", "QA-Panel", "QA-Panel-2", "Highlights"]);
  });

  it("does not hand out a name a later section already spells", () => {
    const m = uniqueFolderNames([
      { id: "a", name: "Day" },
      { id: "b", name: "Day 2" },
      { id: "c", name: "Day" },
    ]);
    expect([...m.values()]).toEqual(["Day", "Day-2", "Day-3"]);
  });

  it("returns names asciiFilePart leaves alone, so re-sanitising is a no-op", () => {
    for (const f of uniqueFolderNames([{ id: "a", name: "José" }, { id: "b", name: "Jose" }]).values()) {
      expect(asciiFilePart(f, "Section")).toBe(f);
    }
  });
});

describe("asciiFilePart — download filenames and ZIP folders", () => {
  it("folds accents instead of deleting the letter", () => {
    // What guests downloaded before 2026-09-14: "Jos-Garca", "Caf-Night".
    expect(asciiFilePart("José García", "Section")).toBe("Jose-Garcia");
    expect(asciiFilePart("Café Night", "gallery")).toBe("Cafe-Night");
    expect(asciiFilePart("Nguyễn Văn Muñoz", "Section")).toBe("Nguyen-Van-Munoz");
  });

  it("keeps case — it is a label a person reads, not a key", () => {
    expect(asciiFilePart("ÉCOLE Day", "gallery")).toBe("ECOLE-Day");
    expect(asciiFilePart("Søren Ærø", "Section")).toBe("Soren-AEro");
    expect(asciiFilePart("Straße", "Section")).toBe("Strasse");
  });

  it("reads a decomposed Mac-export spelling the same as a typed one", () => {
    const decomposed = "José".normalize("NFD");
    expect(decomposed).not.toBe("José");
    expect(asciiFilePart(decomposed, "Section")).toBe("Jose");
  });

  it("is ASCII on every input", () => {
    for (const s of ["Łódź ™ Night", "東京 Highlights", "Ωmega 🎉 Party", "Đỗ Ái"]) {
      expect(asciiFilePart(s, "x")).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("drops the punctuation the old character class let through", () => {
    // `[^a-zA-Z0-9-_ ]` held the RANGE 9-_ (0x39–0x5F), so : ? < > \ survived
    // and Windows refused to extract the folder.
    expect(asciiFilePart("Q&A: Panel?", "Section")).toBe("QA-Panel");
    expect(asciiFilePart(String.raw`A\B <C> [D] ^E @F =G ;H`, "Section")).toBe("AB-C-D-E-F-G-H");
  });

  it("collapses spaced separators but keeps a real hyphen and underscore", () => {
    expect(asciiFilePart("Q&A - Panel", "Section")).toBe("QA-Panel");
    expect(asciiFilePart("Jean-Luc  Picard", "Section")).toBe("Jean-Luc-Picard");
    expect(asciiFilePart("  - Highlights -  ", "Section")).toBe("Highlights");
    expect(asciiFilePart("day_2", "Section")).toBe("day_2");
  });

  it("falls back when nothing survives", () => {
    expect(asciiFilePart("東京", "gallery")).toBe("gallery");
    expect(asciiFilePart("!!!", "Section")).toBe("Section");
    expect(asciiFilePart("", "selection")).toBe("selection");
  });

  it("leaves plain ASCII names exactly as the old rule did", () => {
    for (const s of ["Highlights", "HDC 2026", "Island HQ Headshot Day", "Justin_Group-2"]) {
      const old = s.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "-").trim() || "Section";
      expect(asciiFilePart(s, "Section")).toBe(old);
    }
  });
});
