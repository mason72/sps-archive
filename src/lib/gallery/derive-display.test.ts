import { describe, it, expect } from "vitest";
import { deriveDisplayImages, deriveDisplayStacks, type DisplayInput } from "./derive-display";
import type { ImageData, StackData } from "@/types/image";

// ─── Test fixtures ───
function img(id: string): ImageData {
  return {
    id,
    r2Key: `events/e1/originals/${id}.jpg`,
    thumbnailUrl: `thumb-${id}`,
    originalUrl: `orig-${id}`,
    originalFilename: `${id}.jpg`,
    aestheticScore: null,
    sharpnessScore: null,
    stackId: null,
    stackRank: null,
    parsedName: null,
    processingStatus: "complete",
    width: 800,
    height: 600,
    createdAt: "2026-01-01T00:00:00Z",
    takenAt: null,
  };
}

function stack(id: string, imageIds: string[]): StackData {
  return {
    id,
    stackType: "similar",
    imageCount: imageIds.length,
    personName: null,
    images: imageIds.map(img),
  };
}

const a = img("a");
const b = img("b");
const c = img("c");
const allImages = [a, b, c];

function base(overrides: Partial<DisplayInput> = {}): DisplayInput {
  return {
    isSearching: false,
    searchResults: null,
    activeSection: null,
    sectionImageIds: null,
    allImages,
    allStacks: [],
    ...overrides,
  };
}

describe("deriveDisplayImages", () => {
  it("shows the full set in the All Images view (no active section)", () => {
    expect(deriveDisplayImages(base())).toEqual(allImages);
  });

  it("filters to the active section's members once IDs are loaded", () => {
    const result = deriveDisplayImages(
      base({ activeSection: "s1", sectionImageIds: new Set(["a", "c"]) })
    );
    expect(result).toEqual([a, c]);
  });

  it("REGRESSION: a section whose IDs have not loaded yet shows the full set, NOT empty", () => {
    // This is the exact bug that showed "No images yet" on a populated section.
    const result = deriveDisplayImages(
      base({ activeSection: "s1", sectionImageIds: null })
    );
    expect(result).toEqual(allImages);
    expect(result).not.toHaveLength(0);
  });

  it("returns an empty list for a genuinely empty section (IDs loaded, none match)", () => {
    const result = deriveDisplayImages(
      base({ activeSection: "s1", sectionImageIds: new Set<string>() })
    );
    expect(result).toEqual([]);
  });

  it("returns search results when searching, ignoring the active section", () => {
    const result = deriveDisplayImages(
      base({
        isSearching: true,
        searchResults: [b],
        activeSection: "s1",
        sectionImageIds: new Set(["a"]),
      })
    );
    expect(result).toEqual([b]);
  });

  it("returns an empty list when searching with no results yet (not the full set)", () => {
    const result = deriveDisplayImages(
      base({ isSearching: true, searchResults: null })
    );
    expect(result).toEqual([]);
  });
});

describe("deriveDisplayStacks", () => {
  it("shows all stacks in the All Images view", () => {
    const s = stack("st1", ["a", "b"]);
    expect(deriveDisplayStacks(base({ allStacks: [s] }))).toEqual([s]);
  });

  it("filters each stack's images to the active section and drops emptied stacks", () => {
    const s1 = stack("st1", ["a", "b"]); // a in section, b not
    const s2 = stack("st2", ["c"]); // c not in section → stack dropped
    const result = deriveDisplayStacks(
      base({
        allStacks: [s1, s2],
        activeSection: "sec",
        sectionImageIds: new Set(["a"]),
      })
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("st1");
    expect(result[0].images.map((i) => i.id)).toEqual(["a"]);
  });

  it("REGRESSION: a section with un-loaded IDs shows all stacks, not none", () => {
    const s = stack("st1", ["a"]);
    const result = deriveDisplayStacks(
      base({ allStacks: [s], activeSection: "sec", sectionImageIds: null })
    );
    expect(result).toEqual([s]);
  });

  it("shows no stacks while searching (search is a flat list)", () => {
    const s = stack("st1", ["a"]);
    const result = deriveDisplayStacks(
      base({ allStacks: [s], isSearching: true, searchResults: [a] })
    );
    expect(result).toEqual([]);
  });
});
