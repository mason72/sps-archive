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
 * event noise. Pure punctuation/spacing differences ("Smith, John" vs
 * "Smith John") are NOT a shorter prefix and keep the parsed form.
 */
export function stackPersonName(img: GalleryImage): string {
  return personNameFromParts(img.parsedName, img.originalFilename);
}

/** Lowercased, punctuation/space-free form for name comparisons. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
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
  // Compare punctuation/space-insensitively: nameBeforeDate camel-splits
  // ("AaronCote" → "Aaron Cote"), so a raw startsWith against parsedName
  // ("AaronCote Appfolio") never matched and event tags survived (the
  // Appfolio stacks bug). Normalized, the strict-prefix intent works for
  // both spaced and CamelCase names.
  if (dated) {
    const datedNorm = normName(dated);
    const parsedNorm = normName(parsed);
    if (datedNorm.length < parsedNorm.length && parsedNorm.startsWith(datedNorm)) {
      return dated;
    }
  }
  return parsed;
}

/* ─── Corpus-aware event-tag stripping ───
 * A word that appears in MOST of an event's distinct names isn't a name —
 * it's an event tag ("Appfolio", "CollegeBoardSLC") that survived filename
 * parsing. Frequency across the whole set catches it with zero configuration,
 * including files with no date anchor, and merges tagged/untagged variants of
 * the same person into one stack. Thresholds are deliberately conservative so
 * a shared real surname is never treated as a tag (family shoots stay under
 * the distinct-name floor; larger events rarely share one surname 60%+). */
const EVENT_TAG_MIN_DISTINCT = 15; // distinct names before frequency is trusted
const EVENT_TAG_MIN_COUNT = 10; // token must appear in at least this many names
const EVENT_TAG_MIN_RATIO = 0.6; // ...and in this fraction of distinct names
/** Stripping the token must leave a person-looking name in this fraction of
 *  the names carrying it — the guard that separates an event tag ("Aaron Cote
 *  Appfolio" → "Aaron Cote") from a dominant shared surname ("Aaron Doe" →
 *  "Aaron"), which must never be stripped. */
const EVENT_TAG_MIN_PERSONISH = 0.8;

function nameTokens(name: string): string[] {
  return name
    .split(/\s+/)
    .map((w) => normName(w))
    .filter((t) => t.length > 0);
}

/** Does a name still read as a person? Multiple words, or one CamelCase word
 *  ("AaronCote"). A lone plain word ("Aaron") doesn't qualify. */
function looksPersonish(name: string): boolean {
  const t = name.trim();
  return /\s/.test(t) || /^[A-Z][a-z]+[A-Z]/.test(t);
}

/** `name` with every word matching `token` (normalized) removed. */
function stripToken(name: string, token: string): string {
  return name
    .split(/\s+/)
    .filter((w) => normName(w) !== token)
    .join(" ")
    .trim();
}

/**
 * Build a cleaner over ALL of a set's raw person names. Returns a function
 * that strips event-tag tokens from a name — or returns it untouched when the
 * set is too small to judge, no token clears the thresholds, or stripping
 * would erase the whole name.
 */
export function buildNameCleaner(rawNames: Iterable<string>): (name: string) => string {
  const distinct = new Map<string, string[]>();
  // One representative original-cased name per distinct key, for the
  // personish check below (tokens are normalized; casing matters there).
  const originals = new Map<string, string>();
  for (const n of rawNames) {
    const key = n.toLowerCase();
    if (!distinct.has(key)) {
      distinct.set(key, nameTokens(n));
      originals.set(key, n);
    }
  }
  const total = distinct.size;
  if (total < EVENT_TAG_MIN_DISTINCT) return (n) => n;

  const df = new Map<string, number>();
  for (const tokens of distinct.values()) {
    for (const t of new Set(tokens)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const tags = new Set<string>();
  for (const [t, count] of df) {
    if (t.length < 3 || count < EVENT_TAG_MIN_COUNT || count / total < EVENT_TAG_MIN_RATIO) {
      continue;
    }
    // Frequency alone can't tell a tag from a dominant shared surname —
    // require that removal usually leaves something person-shaped.
    let carriers = 0;
    let personish = 0;
    for (const [key, tokens] of distinct) {
      if (!tokens.includes(t)) continue;
      carriers++;
      if (looksPersonish(stripToken(originals.get(key)!, t))) personish++;
    }
    if (carriers > 0 && personish / carriers >= EVENT_TAG_MIN_PERSONISH) {
      tags.add(t);
    }
  }
  if (tags.size === 0) return (n) => n;

  return (name) => {
    const kept = name.split(/\s+/).filter((w) => !tags.has(normName(w)));
    const cleaned = kept.join(" ").trim();
    if (!cleaned) return name; // a name that IS the tag keeps itself
    // Stripping a tag can leave a fused CamelCase token ("AaronCote") — split
    // it like the filename extractors do, so anchor-less files read the same
    // as date-anchored ones ("Aaron Cote").
    if (cleaned !== name && !/\s/.test(cleaned)) {
      return cleaned.replace(/([a-z])([A-Z])/g, "$1 $2");
    }
    return cleaned;
  };
}

/** A person stack over any image shape carrying the fields we group by. */
export interface PersonStack<T> {
  /** Stable key for React lists (normalized person name). */
  key: string;
  /** Display name for the stack (as parsed — e.g. "Smith, John"). */
  personName: string;
  /** Members in gallery order; length 1 renders as a plain card. */
  images: T[];
}

export type GalleryStack = PersonStack<GalleryImage>;

/**
 * Group images into person stacks, preserving first-appearance order.
 *
 * Generic over the minimal shape it reads (`parsedName` + `originalFilename`)
 * so BOTH the public gallery (`GalleryImage`) and the editor grid (`ImageData`)
 * derive stacks through this ONE function — the grouping rule lives here alone.
 */
export function buildStacks<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[]): PersonStack<T>[] {
  // Two passes: derive every raw name first so the event-tag cleaner can see
  // the whole corpus, then group by the cleaned, punctuation-insensitive key
  // (so "Aaron Cote" and "Aaron, Cote" are one person, not two stacks).
  const rawNames = images.map((img) =>
    personNameFromParts(img.parsedName, img.originalFilename)
  );
  const clean = buildNameCleaner(rawNames);
  const groups = new Map<string, PersonStack<T>>();
  images.forEach((img, i) => {
    const personName = clean(rawNames[i]);
    const key = normName(personName) || personName.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.images.push(img);
    } else {
      groups.set(key, { key, personName, images: [img] });
    }
  });
  return Array.from(groups.values());
}
