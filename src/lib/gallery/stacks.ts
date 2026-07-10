import type { GalleryImage } from "@/types/gallery";

/**
 * Smart stacks — group a gallery's photos by the person they belong to,
 * derived from the filename, so twenty shots of one senior render as a single
 * rotating stack card instead of a wall of near-duplicates.
 *
 * Grouping key: the upload pipeline's `parsedName` when present (e.g.
 * "Smith, John" from SmithJohn_001.jpg), else `extractPersonName` on the raw
 * filename. Grouping preserves the incoming image order (first appearance),
 * so stacks respect whatever sort the gallery is showing.
 */

/**
 * Derive a person name from a filename (ported from SimplePhotoShare v2).
 * "JohnSmith_24-01-30_1234.jpg" → "John Smith"; "Amber Artis_001.jpg" →
 * "Amber Artis". Falls back to the first underscore-delimited segment.
 */
export function extractPersonName(filename: string): string {
  const base = filename.replace(/\.\w+$/, "");
  const match = base.match(/^(.+?)(?:_\d{2,4}-|--|-\d{2}-\d{2})/);
  let name: string;
  if (match) {
    name = match[1].replace(/_/g, " ").trim();
  } else {
    name = base.split("_")[0];
  }
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").trim();
}

/**
 * The name segment BEFORE a date/double-dash separator, or null when the
 * filename has no such anchor. Unlike extractPersonName this never guesses
 * from the first underscore segment — it only answers when the filename
 * itself proves where the name ends.
 */
export function nameBeforeDate(filename: string): string | null {
  const base = filename.replace(/\.\w+$/, "");
  const match = base.match(/^(.+?)(?:_\d{2,4}-|--|-\d{2}-\d{2})/);
  if (!match) return null;
  const name = match[1].replace(/_/g, " ").trim();
  return name.replace(/([a-z])([A-Z])/g, "$1 $2").trim() || null;
}

/**
 * Person name for stack display. Prefers the stored parsedName, EXCEPT when
 * the upload parser absorbed trailing event tokens past the date segment
 * ("Rushi Sheth_26-06-24_CollegeBoardSLC_1581.jpg" → "Rushi Sheth
 * CollegeBoardSLC"): if the date-anchored filename split yields a strict
 * prefix of parsedName, the shorter split is the person and the tail is
 * event noise. Punctuation differences ("Smith, John") fail the prefix test
 * and keep the parsed form.
 */
export function stackPersonName(img: GalleryImage): string {
  return personNameFromParts(img.parsedName, img.originalFilename);
}

/**
 * The person-name derivation, decoupled from GalleryImage so server code
 * (auto-sections) can reuse the exact same logic on raw DB rows
 * (parsed_name + original_filename). stackPersonName is the gallery-side
 * wrapper. Keep the two in lockstep so sections and stacks always agree on
 * who a photo belongs to.
 */
export function personNameFromParts(
  parsedName: string | null | undefined,
  originalFilename: string
): string {
  const parsed = parsedName?.trim();
  if (!parsed) return extractPersonName(originalFilename);
  const dated = nameBeforeDate(originalFilename);
  if (
    dated &&
    dated.length < parsed.length &&
    parsed.toLowerCase().startsWith(dated.toLowerCase())
  ) {
    return dated;
  }
  return parsed;
}

export interface GalleryStack {
  /** Stable key for React lists (normalized person name). */
  key: string;
  /** Display name for the stack (as parsed — e.g. "Smith, John"). */
  personName: string;
  /** Members in gallery order; length 1 renders as a plain card. */
  images: GalleryImage[];
}

/** Group images into person stacks, preserving first-appearance order. */
export function buildStacks(images: GalleryImage[]): GalleryStack[] {
  const groups = new Map<string, GalleryStack>();
  for (const img of images) {
    const personName = stackPersonName(img);
    const key = personName.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.images.push(img);
    } else {
      groups.set(key, { key, personName, images: [img] });
    }
  }
  return Array.from(groups.values());
}
