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
  /** When true, restrict to favorited images (using favoriteIds). */
  favoritesOnly?: boolean;
  /** Ids of favorited images (from the event's active share). */
  favoriteIds?: Set<string>;
}

function inSection(img: ImageData, sectionId: string): boolean {
  return img.sectionIds?.includes(sectionId) ?? false;
}

export function deriveDisplayImages(input: DisplayInput): ImageData[] {
  const { isSearching, searchResults, activeSection, allImages, favoritesOnly, favoriteIds } = input;

  let list: ImageData[];
  if (isSearching) list = searchResults ?? [];
  else if (activeSection) list = allImages.filter((img) => inSection(img, activeSection));
  else list = allImages;

  if (favoritesOnly) {
    const favs = favoriteIds ?? new Set<string>();
    list = list.filter((img) => favs.has(img.id));
  }
  // The cover image is delivered in the payload (for the settings preview) but
  // is never a gallery photo — keep it out of every displayed view.
  return list.filter((img) => !img.isCover);
}

export function deriveDisplayStacks(input: DisplayInput): StackData[] {
  const { isSearching, activeSection, allStacks, favoritesOnly, favoriteIds } = input;

  // Search results are a flat list — stacks are not shown while searching.
  if (isSearching) return [];

  const favs = favoritesOnly ? favoriteIds ?? new Set<string>() : null;
  const keep = (img: ImageData) =>
    !img.isCover &&
    (!activeSection || inSection(img, activeSection)) &&
    (!favs || favs.has(img.id));

  return allStacks
    .map((s) => ({ ...s, images: s.images.filter(keep) }))
    .filter((s) => s.images.length > 0);
}
