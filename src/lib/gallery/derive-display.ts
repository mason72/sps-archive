import type { ImageData, StackData } from "@/types/image";

/**
 * Pure derivation of the gallery's displayed images/stacks.
 *
 * This is the logic that decides what the grid shows, extracted from the event
 * page so it can be unit-tested in isolation. It encodes the rule that caused
 * the worst gallery bug ("No images yet" on a populated section): the displayed
 * list is a PURE FUNCTION of its inputs, never set imperatively, and a section
 * whose membership IDs haven't loaded yet falls back to the full set rather
 * than showing empty.
 *
 * Precedence:
 *   1. Searching → the search results (independent of section).
 *   2. A section is active AND its membership IDs are loaded → filter to them.
 *   3. Otherwise → the full set ("All Images", or a section still loading).
 */

export interface DisplayInput {
  isSearching: boolean;
  /** Search results; null when not searching. */
  searchResults: ImageData[] | null;
  /** Active section id, or null for the "All Images" view. */
  activeSection: string | null;
  /** Member image ids for the active section; null while still loading. */
  sectionImageIds: Set<string> | null;
  allImages: ImageData[];
  allStacks: StackData[];
}

export function deriveDisplayImages(input: DisplayInput): ImageData[] {
  const { isSearching, searchResults, activeSection, sectionImageIds, allImages } =
    input;

  if (isSearching) return searchResults ?? [];

  // Only filter once the section's IDs have actually loaded. While they're
  // null we intentionally show the full set — never an empty grid.
  if (activeSection && sectionImageIds) {
    return allImages.filter((img) => sectionImageIds.has(img.id));
  }

  return allImages;
}

export function deriveDisplayStacks(input: DisplayInput): StackData[] {
  const { isSearching, activeSection, sectionImageIds, allStacks } = input;

  // Search results are a flat list — stacks are not shown while searching.
  if (isSearching) return [];

  if (activeSection && sectionImageIds) {
    return allStacks
      .map((s) => ({
        ...s,
        images: s.images.filter((img) => sectionImageIds.has(img.id)),
      }))
      .filter((s) => s.images.length > 0);
  }

  return allStacks;
}
