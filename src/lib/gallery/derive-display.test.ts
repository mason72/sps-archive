import { describe, it, expect } from "vitest";
import { deriveDisplayImages, deriveDisplayStacks, type DisplayInput } from "./derive-display";
import type { ImageData, StackData } from "@/types/image";

// ─── Test fixtures ───
function img(id: string, sectionIds: string[] = []): ImageData {
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
    sectionIds,
  };
}

function stack(id: string, images: ImageData[]): StackData {
  return {
    id,
    stackType: "similar",
    imageCount: images.length,
    personName: null,
    images,
  };
}

// a,c in section "s1"; b in "s2"
const a = img("a", ["s1"]);
const b = img("b", ["s2"]);
const c = img("c", ["s1", "s2"]);
const allImages = [a, b, c];

function base(overrides: Partial<DisplayInput> = {}): DisplayInput {
  return {
    isSearching: false,
    searchResults: null,
    activeSection: null,
    allImages,
    allStacks: [],
    ...overrides,
  };
}

describe("deriveDisplayImages", () => {
  it("shows the full set in the All Images view (no active section)", () => {
    expect(deriveDisplayImages(base())).toEqual(allImages);
  });

  it("filters to images whose sectionIds include the active section", () => {
    expect(deriveDisplayImages(base({ activeSection: "s1" }))).toEqual([a, c]);
    expect(deriveDisplayImages(base({ activeSection: "s2" }))).toEqual([b, c]);
  });

  it("returns an empty list for a section with no members", () => {
    expect(deriveDisplayImages(base({ activeSection: "empty" }))).toEqual([]);
  });

  it("REGRESSION: membership travels with the image, so switching sections is synchronous — never a stale blank grid", () => {
    // The old bug needed a separately-fetched Set that could lag. Now filtering
    // is a pure function of the images already in hand: any active section
    // resolves immediately against img.sectionIds.
    const result = deriveDisplayImages(base({ activeSection: "s1" }));
    expect(result).toEqual([a, c]);
  });

  it("treats an image with no sectionIds as belonging to no section", () => {
    const orphan = img("z"); // sectionIds: []
    const result = deriveDisplayImages(
      base({ allImages: [...allImages, orphan], activeSection: "s1" })
    );
    expect(result.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("returns search results when searching, ignoring the active section", () => {
    const result = deriveDisplayImages(
      base({ isSearching: true, searchResults: [b], activeSection: "s1" })
    );
    expect(result).toEqual([b]);
  });

  it("returns an empty list when searching with no results yet (not the full set)", () => {
    expect(
      deriveDisplayImages(base({ isSearching: true, searchResults: null }))
    ).toEqual([]);
  });

  it("favoritesOnly restricts to favorited images (within the active view)", () => {
    // All images, favorites only = a, c
    expect(
      deriveDisplayImages(
        base({ favoritesOnly: true, favoriteIds: new Set(["a", "c"]) })
      )
    ).toEqual([a, c]);
    // Section s1 (a,c) ∩ favorites (c) = c
    expect(
      deriveDisplayImages(
        base({ activeSection: "s1", favoritesOnly: true, favoriteIds: new Set(["c"]) })
      )
    ).toEqual([c]);
  });

  it("favoritesOnly with no favorites returns empty", () => {
    expect(
      deriveDisplayImages(base({ favoritesOnly: true, favoriteIds: new Set() }))
    ).toEqual([]);
  });
});

describe("deriveDisplayStacks", () => {
  it("shows all stacks in the All Images view", () => {
    const s = stack("st1", [a, b]);
    expect(deriveDisplayStacks(base({ allStacks: [s] }))).toEqual([s]);
  });

  it("filters each stack's images to the active section and drops emptied stacks", () => {
    const s1 = stack("st1", [a, b]); // a in s1, b not
    const s2 = stack("st2", [b]); // none in s1 → dropped
    const result = deriveDisplayStacks(
      base({ allStacks: [s1, s2], activeSection: "s1" })
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("st1");
    expect(result[0].images.map((i) => i.id)).toEqual(["a"]);
  });

  it("shows no stacks while searching (search is a flat list)", () => {
    const s = stack("st1", [a]);
    const result = deriveDisplayStacks(
      base({ allStacks: [s], isSearching: true, searchResults: [a] })
    );
    expect(result).toEqual([]);
  });
});
