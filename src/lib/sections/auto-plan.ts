import { buildNameCleaner, personNameFromParts } from "@/lib/gallery/stacks";
import { foldName, nameText } from "@/lib/people/name-text";

/**
 * Auto-sections — turn a big undifferentiated upload into balanced, scannable
 * sections without the photographer doing any math.
 *
 * Four layouts, auto-detected but user-overridable:
 *  - "letter"     : first-name letter-RANGE sections ("A–C", "D–F"), balanced
 *                   to a target size, never splitting a letter across sections
 *                   (so a person's whole initial is always in one place).
 *  - "per-person" : one section per person (small jobs, ~≤20 people).
 *  - "full-set"   : everything in ONE "Full Set" section, upload order — the
 *                   default for non-person-named dumps (photo booth, event
 *                   coverage), where the pairing is Highlights + Full Set.
 *  - "even"       : plain even chunks by upload order ("Set 1…N") — the
 *                   opt-in alternative when one huge section is too unwieldy.
 *
 * Everything is derived from the FILENAME (reusing the gallery's person-name
 * logic) — no AI, fully deterministic, so the client preview and the server
 * apply produce byte-identical results.
 */

export type PlanMode = "letter" | "per-person" | "even" | "full-set";

/** The single section "full-set" mode creates. */
export const FULL_SET_SECTION_NAME = "Full Set";

/** The minimal per-image input the planner needs. */
export interface PlanImage {
  id: string;
  parsedName?: string | null;
  originalFilename: string;
}

/** A resolved image with its derived person name (computed once). */
interface NamedImage {
  id: string;
  personName: string;
  /** Stable sort key: person name, then filename, both lowercased. */
  sortKey: string;
  /** First-name initial, uppercased; "#" for anything non-alphabetic. */
  initial: string;
  /** True when the name looks like a real "First Last" person name. */
  personLike: boolean;
  /** True when the name can go in a letter bucket (letter-initial, no digits). */
  namey: boolean;
}

export interface PlannedSection {
  name: string;
  imageIds: string[];
  /** Distinct people in this section (for the preview's "N people" label). */
  people: number;
}

export interface DetectionSummary {
  totalImages: number;
  distinctPeople: number;
  shotsPerPerson: number;
  /** Fraction of distinct names that look like real people (0–1). */
  personLikeRatio: number;
  /** True when the set looks person-named (headshot job). */
  personNamed: boolean;
  suggestedMode: PlanMode;
  /** Smart default for the max-per-section slider, in the mode's unit. */
  suggestedTarget: number;
}

/**
 * A name is "person-like" if it reads as at least two alphabetic tokens.
 * Exported so Smart Stacks detection asks the SAME question auto-sections does
 * — two features disagreeing about whether a set is person-named would be worse
 * than either being wrong.
 */
export function isPersonLike(name: string): boolean {
  // "Chelsee Crawford", "Nga Chi Lai", "Smith, John", "José García" → yes.
  // "2Dudes WF", "JRM7521", "VTVFMTE3UDY1", "Cher" → no.
  // Letters are any script's, accents included (name-text.ts) — this also
  // gates the face-cluster namer, which refused "José García" until 2026-09-11.
  return /^\p{L}[\p{L}\p{M}'’.-]*,?\s+\p{L}/u.test(nameText(name).trim());
}

/**
 * A name is "namey" — a plausible person name for LETTER bucketing — if it
 * starts with a letter and contains no digits. Looser than isPersonLike so a
 * single-name person ("Cher") still buckets under C, but strict enough to send
 * camera codes ("JRM7521", "2Dudes WF") to Misc instead of a bogus letter
 * section. (Real headshot names are digit-free once the date-anchored cleaner
 * strips the trailing frame code.)
 */
function isNamey(name: string): boolean {
  const t = nameText(name).trim();
  return /^\p{L}/u.test(t) && !/\d/.test(t);
}

function initialOf(name: string): string {
  // Folded, so "Émile" files under E and "Łukasz" under L rather than "#".
  const c = foldName(name.trim()).charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : "#";
}

function resolve(images: PlanImage[]): NamedImage[] {
  // Same corpus-aware event-tag stripping the gallery stacks use, so sections
  // and stacks always agree on who a photo belongs to (and a section is never
  // named "AaronCote Appfolio").
  const rawNames = images.map((img) =>
    personNameFromParts(img.parsedName, img.originalFilename).trim()
  );
  const clean = buildNameCleaner(rawNames);
  return images.map((img, i) => {
    const personName = clean(rawNames[i]);
    return {
      id: img.id,
      personName,
      sortKey: `${personName.toLowerCase()}\u0000${img.originalFilename.toLowerCase()}`,
      initial: initialOf(personName),
      personLike: isPersonLike(personName),
      namey: isNamey(personName),
    };
  });
}

/** Distinct people, keyed case- and punctuation-insensitively (matches the
 *  gallery stacks' normalized key, so "Aaron Cote" ≡ "Aaron, Cote"). */
function peopleOf(items: NamedImage[]): Map<string, NamedImage[]> {
  const groups = new Map<string, NamedImage[]>();
  for (const it of items) {
    const key =
      foldName(it.personName).replace(/[^a-z0-9]+/g, " ").trim() ||
      it.personName.toLowerCase();
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }
  return groups;
}

/** Suggested layout + slider default from the shape of the filenames. */
export function detectNaming(images: PlanImage[]): DetectionSummary {
  const items = resolve(images);
  const total = items.length;
  const people = peopleOf(items);
  const distinctPeople = people.size;
  const personLikeNames = [...people.values()].filter((imgs) =>
    isPersonLike(imgs[0].personName)
  ).length;
  const personLikeRatio = distinctPeople ? personLikeNames / distinctPeople : 0;

  // Person-named when most distinct names read like people. (Repetition —
  // multiple shots per person — reinforces it but isn't required: a 1-shot
  // headshot set is still person-named.)
  const personNamed = personLikeRatio >= 0.6 && distinctPeople >= 2;

  let suggestedMode: PlanMode;
  let suggestedTarget: number;
  if (!personNamed) {
    // Photo booth / event coverage: the right shape is Highlights + one
    // "Full Set" — arbitrary even chunks are the opt-in, not the default.
    suggestedMode = "full-set";
    suggestedTarget = 300; // only used if the user switches to "even"
  } else if (distinctPeople <= 20) {
    suggestedMode = "per-person";
    suggestedTarget = 1; // one person per section (unused, kept for shape)
  } else {
    suggestedMode = "letter";
    // Default so a set lands in ~6–10 sections and feels scannable, clamped to
    // Mason's sensible bounds (~300 photos, or ~65 people when stacked).
    suggestedTarget = 300;
  }

  return {
    totalImages: total,
    distinctPeople,
    shotsPerPerson: distinctPeople ? Math.round((total / distinctPeople) * 10) / 10 : 0,
    personLikeRatio: Math.round(personLikeRatio * 100) / 100,
    personNamed,
    suggestedMode,
    suggestedTarget,
  };
}

export interface PlanOpts {
  mode: PlanMode;
  /** Max units per section (images, or people when `stacks`). */
  target: number;
  /** When true, "letter" mode balances by PEOPLE (stacks), not raw images. */
  stacks?: boolean;
}

/**
 * Produce the section plan. Pure and deterministic — same input, same output,
 * on client and server.
 */
export function planAutoSections(
  images: PlanImage[],
  opts: PlanOpts
): PlannedSection[] {
  const items = resolve(images);
  if (items.length === 0) return [];
  const target = Math.max(1, Math.floor(opts.target));

  if (opts.mode === "per-person") return planPerPerson(items);
  if (opts.mode === "even") return planEven(items, target);
  if (opts.mode === "full-set") return planFullSet(items);
  return planLetter(items, target, !!opts.stacks);
}

/** Everything in one "Full Set" section, upload (input) order. */
function planFullSet(items: NamedImage[]): PlannedSection[] {
  return [
    {
      name: FULL_SET_SECTION_NAME,
      imageIds: items.map((i) => i.id),
      people: peopleOf(items).size,
    },
  ];
}

/** One section per person, alphabetical; a "Misc" section for non-person names. */
function planPerPerson(items: NamedImage[]): PlannedSection[] {
  const named = items.filter((i) => i.personLike);
  const misc = items.filter((i) => !i.personLike);
  const people = peopleOf(named);

  const sections: PlannedSection[] = [...people.entries()]
    .sort((a, b) => a[1][0].sortKey.localeCompare(b[1][0].sortKey))
    .map(([, imgs]) => ({
      name: imgs[0].personName,
      imageIds: sortedIds(imgs),
      people: 1,
    }));

  if (misc.length) sections.push(miscSection(misc));
  return sections;
}

/** Even chunks by upload order (input order); "Set 1…N". */
function planEven(items: NamedImage[], target: number): PlannedSection[] {
  const n = Math.max(1, Math.ceil(items.length / target));
  const per = Math.ceil(items.length / n);
  const sections: PlannedSection[] = [];
  for (let i = 0; i < items.length; i += per) {
    const chunk = items.slice(i, i + per);
    sections.push({
      name: `Set ${sections.length + 1}`,
      imageIds: chunk.map((c) => c.id),
      people: peopleOf(chunk).size,
    });
  }
  return sections;
}

/**
 * First-name letter-range sections, balanced to `target`, never splitting a
 * letter. `stacks` decides the unit the target counts: people (grouped) or
 * raw images.
 */
function planLetter(
  items: NamedImage[],
  target: number,
  stacks: boolean
): PlannedSection[] {
  const named = items.filter((i) => i.namey);
  const misc = items.filter((i) => !i.namey);

  // Group by initial (A, B, C, …, then "#"), each group sorted internally.
  const byInitial = new Map<string, NamedImage[]>();
  for (const it of named) {
    const arr = byInitial.get(it.initial);
    if (arr) arr.push(it);
    else byInitial.set(it.initial, [it]);
  }
  const letters = [...byInitial.keys()].sort(letterOrder);

  // Cost of a letter-group in the target's unit (people vs images).
  const cost = (imgs: NamedImage[]) => (stacks ? peopleOf(imgs).size : imgs.length);

  const buckets: { letters: string[]; items: NamedImage[]; count: number }[] = [];
  let cur: { letters: string[]; items: NamedImage[]; count: number } | null = null;
  for (const letter of letters) {
    const group = byInitial.get(letter)!;
    const c = cost(group);
    if (cur && cur.count > 0 && cur.count + c > target) {
      buckets.push(cur);
      cur = null;
    }
    if (!cur) cur = { letters: [], items: [], count: 0 };
    cur.letters.push(letter);
    cur.items.push(...group);
    cur.count += c;
  }
  if (cur) buckets.push(cur);

  const sections: PlannedSection[] = buckets.map((b) => ({
    name: rangeLabel(b.letters),
    imageIds: sortedIds(b.items),
    people: peopleOf(b.items).size,
  }));

  if (misc.length) sections.push(miscSection(misc));
  return sections;
}

/** "#" sorts last; letters alphabetical. */
function letterOrder(a: string, b: string): number {
  if (a === "#") return 1;
  if (b === "#") return -1;
  return a.localeCompare(b);
}

/** ["A"] → "A"; ["A","B","C"] → "A–C"; a lone "#" → "0–9 · Other". */
function rangeLabel(letters: string[]): string {
  const alpha = letters.filter((l) => l !== "#");
  const hasHash = letters.includes("#");
  if (alpha.length === 0) return "0–9 · Other";
  const label = alpha.length === 1 ? alpha[0] : `${alpha[0]}–${alpha[alpha.length - 1]}`;
  return hasHash ? `${label} · Other` : label;
}

function miscSection(items: NamedImage[]): PlannedSection {
  return { name: "Misc", imageIds: items.map((i) => i.id), people: peopleOf(items).size };
}

function sortedIds(items: NamedImage[]): string[] {
  return [...items].sort((a, b) => a.sortKey.localeCompare(b.sortKey)).map((i) => i.id);
}
