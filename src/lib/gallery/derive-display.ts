import type { ImageData, StackData } from "@/types/image";

/**
 * Pure derivation of the gallery's displayed images/stacks.
 *
 * Extracted from the event page so it can be unit-tested in isolation. It
 * encodes the rule that caused the worst gallery bug ("No images yet" on a
 * populated section): the displayed list is a PURE FUNCTION of its inputs,
 * never set imperatively.
 *
 * Section membership now travels WITH each image (`image.sectionIds`, loaded in
 * the main event payload), so filtering is a synchronous in-memory check — there
 * is no separately-fetched membership Set that can lag behind a section switch
 * and momentarily blank the grid.
 *
 * Precedence:
 *   1. Searching → the search results (independent of section).
 *   2. A section is active → images whose sectionIds include it.
 *   3. Otherwise → the full set ("All Images").
 */

export interface DisplayInput {
  isSearching: boolean;
  /** Search results; null when not searching. */
  searchResults: ImageData[] | null;
  /** Active section id, or null for the "All Images" view. */
  activeSection: string | null;
  allImages: ImageData[];
  allStacks: StackData[];
}

function inSection(img: ImageData, sectionId: string): boolean {
  return img.sectionIds?.includes(sectionId) ?? false;
}

export function deriveDisplayImages(input: DisplayInput): ImageData[] {
  const { isSearching, searchResults, activeSection, allImages } = input;

  if (isSearching) return searchResults ?? [];
  if (activeSection) return allImages.filter((img) => inSection(img, activeSection));
  return allImages;
}

export function deriveDisplayStacks(input: DisplayInput): StackData[] {
  const { isSearching, activeSection, allStacks } = input;

  // Search results are a flat list — stacks are not shown while searching.
  if (isSearching) return [];

  if (activeSection) {
    return allStacks
      .map((s) => ({
        ...s,
        images: s.images.filter((img) => inSection(img, activeSection)),
      }))
      .filter((s) => s.images.length > 0);
  }

  return allStacks;
}
