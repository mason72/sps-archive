import type { GalleryImage } from "@/types/gallery";
import { foldName, nameText, splitCamel } from "@/lib/people/name-text";

/**
 * Smart stacks — group a gallery's photos by the person they belong to,
 * derived from the filename, so twenty shots of one senior render as a single
 * rotating stack card instead of a wall of near-duplicates.
 *
 * Grouping key: the upload pipeline's `parsedName` when present (e.g.
 * "John Smith" from JohnSmith_001.jpg), else `extractPersonName` on the raw
 * filename. Grouping preserves the incoming image order (first appearance),
 * so stacks respect whatever sort the gallery is showing.
 */

/**
 * The name, then the separator that proves where it ends: a dashed date
 * ("_26-01-27", "-03-10"), a double dash, or a COMPACT date between
 * underscores ("_260603_", YYMMDD with a real month and day). The compact
 * form went unrecognised until 2026-09-14, so "PatrickStrozzo_260603_
 * FMheadshots_0172.jpg" keyed as "patrickstrozzofmheadshots" and 1,029 named
 * rows carried their event tag into /people (lesson 143). Both name readers
 * share this one pattern so they cannot disagree about where a name stops.
 */
const NAME_THEN_DATE =
  /^(.+?)(?:_\d{2,4}-|--|-\d{2}-\d{2}|_\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])_)/;

/**
 * Derive a person name from a filename (ported from SimplePhotoShare v2).
 * "JohnSmith_24-01-30_1234.jpg" → "John Smith"; "Amber Artis_001.jpg" →
 * "Amber Artis". Falls back to the first underscore-delimited segment.
 */
export function extractPersonName(filename: string): string {
  // NFC + stray leading symbols dropped, and a Unicode case split
  // ("TaísSales" → "Taís Sales") — see name-text.ts.
  const base = nameText(filename).replace(/\.\w+$/, "");
  const match = base.match(NAME_THEN_DATE);
  let name: string;
  if (match) {
    name = match[1].replace(/_/g, " ").trim();
  } else {
    name = base.split("_")[0];
  }
  return splitPersonWords(name);
}

/**
 * A name as words: fused CamelCase split (`splitCamel`) and typo repeats
 * collapsed (`collapseRepeatedWords`) — the ONE home both filename readers
 * and the upload parser use, so they cannot disagree about a name's words.
 *
 * A doubled word FUSED at the start of a longer name is a name, not a typo:
 * "DeeDeeAcquista" is Dee Dee Acquista and "SinhSinh An" is Sinh Sinh An. The
 * collapse used to run after the split and read both as repeats, so their
 * tagged files keyed as "deedeeacquistadtexmarch" and "sinhsinhangels" (lesson
 * 147). The collapse still applies where it was meant to: a surname typed
 * twice ("Tori Marifian Marifian", "IreneGonzalezGonzalez"), a spaced repeat
 * ("Ann ann Lee"), or a name that is only the doubled word ("LauraLaura").
 */
export function splitPersonWords(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  const words = tokens.flatMap((t) => splitCamel(t).split(" "));
  const lead = tokens.length ? splitCamel(tokens[0]).split(" ") : [];
  const fusedDouble = lead.length >= 2 && lead[0] === lead[1] && words.length > 2;
  if (!fusedDouble) return collapseRepeatedWords(words.join(" "));
  return `${words[0]} ${collapseRepeatedWords(words.slice(1).join(" "))}`;
}

/**
 * "Tori Marifian Marifian" → "Tori Marifian". A word repeated back-to-back in
 * a filename is a typo at the shoot, never a name — one such file on the
 * Appfolio day minted a second Tori on /people AND renamed her 37-face
 * cluster (2026-08-21). Applied at every name-extraction home so the
 * filename, the stack label, the cluster name and the /people identity all
 * agree. Case-insensitive; keeps the first spelling.
 */
export function collapseRepeatedWords(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length && out[out.length - 1].toLowerCase() === w.toLowerCase()) continue;
    out.push(w);
  }
  return out.join(" ");
}

/**
 * The name segment BEFORE a date/double-dash separator, or null when the
 * filename has no such anchor. Unlike extractPersonName this never guesses
 * from the first underscore segment — it only answers when the filename
 * itself proves where the name ends.
 */
export function nameBeforeDate(filename: string): string | null {
  const base = nameText(filename).replace(/\.\w+$/, "");
  const match = base.match(NAME_THEN_DATE);
  if (!match) return null;
  const name = match[1].replace(/_/g, " ").trim();
  return splitPersonWords(name) || null;
}

/**
 * Person name for stack display. Prefers the stored parsedName, EXCEPT when
 * the upload parser absorbed trailing event tokens past the date segment
 * ("Rushi Sheth_26-06-24_CollegeBoardSLC_1581.jpg" → "Rushi Sheth
 * CollegeBoardSLC"): if the date-anchored filename split yields a strict
 * prefix of parsedName, the shorter split is the person and the tail is
 * event noise. Pure punctuation/spacing differences ("Smith, John" vs
 * "Smith John") are NOT a shorter prefix; the parser's guessed comma is then
 * dropped when the filename spells the name fused (see personNameFromParts).
 */
export function stackPersonName(img: GalleryImage): string {
  return personNameFromParts(img.parsedName, img.originalFilename);
}

/** Lowercased, accent-folded, punctuation/space-free form for name comparisons. */
function normName(s: string): string {
  return foldName(s).replace(/[^a-z0-9]/g, "");
}

/**
 * Display casing — the ONE home, used by stacks, sections and /people.
 * Filenames arrive shouted or lowercased ("ANDREW MC CARTNEY",
 * "andrew dorman") and a wall of those reads like a spreadsheet. Title-case
 * ONLY when the whole name is single-case — mixed case is left exactly as
 * typed, because that's where the real ones live (McCartney, de Vries, O'Neil)
 * and "fixing" them is how you misspell someone's name on a wall of fame.
 */
export function displayName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const isSingleCase =
    trimmed === trimmed.toLowerCase() || trimmed === trimmed.toUpperCase();
  if (!isSingleCase) return trimmed;
  return trimmed
    .split(" ")
    .map((w) =>
      w
        // Hyphenated and apostrophe'd parts each get their own capital
        // (Anne-Marie, O'Neil).
        .split(/([-'’])/)
        .map((part) =>
          /^[-'’]$/.test(part)
            ? part
            : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        )
        .join("")
    )
    .join(" ");
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
  const parsed = parsedName ? nameText(parsedName).trim() : "";
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
  } else if (/\p{N}/u.test(parsed)) {
    const named = undatedEventExportName(originalFilename);
    if (named) return named;
  }
  return unfuseParserComma(parsed, originalFilename);
}

/** Words that describe the SHOOT, never the person — a name carrying one is a
 *  fused event tag ("JeamarieCastroDataDogHeadshots"), not a name. */
const SHOOT_WORDS = /^(headshots?|portraits?|photos?|photography|pics?|booth|event|sko)$/i;

/**
 * The person in an undated event export, "AudreyEasley_DataDogHeadshots_NYC30119.jpg"
 * → "Audrey Easley", or null. The upload parser keeps every non-numeric part,
 * so its name ends in the frame-numbered tag ("…NYC30119"), fails every
 * person-shape test, and is unique per frame — 1,034 of DATADOG HEADSHOTS
 * NYC's 2,966 photos were off /people for that reason (lesson 140). With no
 * date to prove where the name ends, the first underscore segment is the only
 * candidate, so it is accepted only in the shape every real export measured
 * had: a FUSED segment ("EmmaSayiner", never "Maria Jose", whose surname may be
 * the next segment) splitting to two+ words with no digits and no shoot word,
 * in a filename carrying a frame counter (3+ digits — "GroupShot_A12" is not
 * an export). A fused tag stays unnamed rather than minting "Jeamarie Castro
 * Data Dog": a wrong name is worse than a missing one. A brand shaped exactly
 * like a person ("CollegeBoard_SLC1234") can still pass; that is the label
 * filter's and "Not a person"'s job, as for every other filename.
 */
function undatedEventExportName(originalFilename: string): string | null {
  // The parser strips SPS's "(AI) " render prefix; this path reads the raw
  // filename, so it must too, or a render keys as a second person.
  const file = originalFilename.replace(/^\(AI\)\s*/i, "");
  if (!/\d{3,}/.test(file)) return null;
  const segment = nameText(file).replace(/\.\w+$/, "").split("_")[0].trim();
  if (/\s/.test(segment)) return null;
  const name = extractPersonName(file);
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2 || /\p{N}/u.test(name)) return null;
  return words.some((w) => SHOOT_WORDS.test(w)) ? null : name;
}

/**
 * "Kelly, Bottarini" → "Kelly Bottarini", when the filename reads
 * "KellyBottarini". The upload parser turns a two-word CamelCase stem into
 * "Last, First" (parse-filename.ts), but it never reorders — the comma is a
 * guess about which word is the surname, and for event exports it is wrong
 * (first name first). The comma also failed every person-shape test, so 429
 * such identities — 7,051 photos, KELLY BOTTARINI'S HEADSHOTS entire — were
 * off /people until 2026-09-14 (lesson 140). The key is unchanged either way
 * (normalizeNameKey drops punctuation), so this can only ADD photos to an
 * identity, never merge or split one. A comma the filename itself carries
 * ("Smith, John.jpg") is left alone.
 */
function unfuseParserComma(parsed: string, originalFilename: string): string {
  const m = parsed.match(/^(\S+), (\S+)$/);
  if (!m) return parsed;
  return nameText(originalFilename).includes(m[1] + m[2]) ? `${m[1]} ${m[2]}` : parsed;
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
  return /\s/.test(t) || /^\p{Lu}[\p{Ll}\p{M}]+\p{Lu}/u.test(t);
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
      return splitCamel(cleaned);
    }
    return cleaned;
  };
}

/** A person stack over any image shape carrying the fields we group by. */
export interface PersonStack<T> {
  /** Stable key for React lists (normalized person name). */
  key: string;
  /** Display name for the stack, title-cased via `displayName`. */
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
    // Title-cased for display. Filenames arrive shouted or lowercased
    // ("pete destefano"), and a grid of those reads like a spreadsheet — but
    // MIXED case is left exactly as typed, because that's the only evidence
    // we'll ever have that someone writes their name "DeStefano".
    const personName = displayName(clean(rawNames[i]));
    // Grouping is case-insensitive (normName lowercases), so display casing
    // can never split one person into two stacks.
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
