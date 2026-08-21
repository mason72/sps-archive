import { describe, it, expect } from "vitest";
import { downloadGateKind, scopeIsWholeGallery } from "./download-gate";

describe("downloadGateKind", () => {
  it("only the whole gallery on a full share is bulk", () => {
    expect(downloadGateKind({ curated: false, scope: {} })).toBe("bulk");
  });

  it("a person's stack / selection / section / favorites are subsets", () => {
    for (const scope of [
      { images: "a,b,c" },
      { images: ["a"] },
      { section: "11111111-2222-3333-4444-555555555555" },
      { favorites: true },
      { favorites: "true" },
    ]) {
      expect(downloadGateKind({ curated: false, scope })).toBe("individual");
    }
  });

  it("a curated share link's 'download all' is a group, not the gallery", () => {
    expect(downloadGateKind({ curated: true, scope: {} })).toBe("individual");
  });

  it("empty strings and empty lists still mean the whole gallery", () => {
    expect(scopeIsWholeGallery({ images: "", section: "", favorites: "false" })).toBe(true);
    expect(scopeIsWholeGallery({ images: [] })).toBe(true);
  });
});
