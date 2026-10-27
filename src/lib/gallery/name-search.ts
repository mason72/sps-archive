/**
 * Name search over a gallery's photos — the ONE matcher behind the guest
 * gallery's search box and the editor's.
 *
 * Why it exists (2026-10-26): a client searched Money 2020 USA for "Stacey
 * Chen" and got "No photos match". Her 10 photos were stored as "stacy chen",
 * the spelling the guest typed at the booth. "stac" matched (a substring of
 * both spellings), "stace" did not, and the miss fell through to the visual
 * (AI) search, which reads what a photo SHOWS and cannot read a name. Names
 * here come from what guests type at check-in, so every gallery carries
 * misspellings ("AINSLEY JOHSNTON" in the same one), and the client searches
 * from a correctly spelled attendee list.
 *
 * Two tiers, in order:
 *  1. EXACT — a photo matches when the whole query is inside its folded
 *     name or inside its folded filename (the old rule, field by field, so
 *     nothing that used to match stops matching), or when every query word is
 *     a NAME FORM of it, in any order ("chen stacy"): it starts a word, or,
 *     with punctuation dropped, it equals neighbouring words joined ("obrien"
 *     → O'Brien, "maryann" → Mary-Ann). The query with its spaces dropped may
 *     be a name form too ("de la cruz" → Delacruz). Starts and equals, never
 *     anywhere-inside or "starts a join": loosely, "old man" found Harold
 *     Bowman, "bench" Ben Chen, "gray" Lang + Raymond across the two fields,
 *     and "1020" every photo of a 10-20 shoot, and an exact hit hides the AI
 *     search with no link through. A digit word in a phrase must be 3+ digits
 *     (a frame number), because every SPS filename carries 26, 10 and 20.
 *  2. FUZZY — only when exact finds NOTHING. Every query word must be close to
 *     a word of the person's name (or two or three neighbouring words joined,
 *     for "De La Cruz"). An edit is one inserted, deleted, changed or SWAPPED
 *     letter, so "johsnton" is one edit from "johnston":
 *       - 5–8 letters: one edit; 9+: two.
 *       - 3–4 letters: one edit only inside a phrase (two or more words of 3+
 *         letters, all landing on the same person: "stacy chan", "jon smith");
 *         alone, and always under 3, it must be the start of a name word,
 *         which is what keeps a half-typed surname ("stacey c") matching.
 *       - The first letter must match, C and K counting as one (Catherine /
 *         Katherine).
 *       - The word still being typed (the last, 6+ letters) is also compared
 *         against the start of longer name words ("christoph").
 *       - Only Latin-script words take edits; other scripts match exactly or
 *         by their start (a letter-by-letter distance miscounts Hangul and
 *         rare CJK).
 *     Only the closest tier is returned, so a near-perfect match never drags
 *     in a pile of weaker ones.
 *
 *     The limits are measured, not guessed
 *     (`scripts/triage/name-search-false-positives.ts`): on a 3,000-photo,
 *     1,000-person gallery the first version (fuzzy from 4 letters, any first
 *     letter, start-of-word compare on every word) turned 34 of 141 common
 *     visual searches into strangers' names ("blue" → Bauer, "band" → 60
 *     photos). These rules leave 3 there, and 13 of 232 on a second reviewer's
 *     gallery: lone 5–8 letter words one letter from a surname ("apron" /
 *     Aaron, "coffee" / Coffey). Closing those would also stop "stacy"
 *     finding a stored "stacey", so the "Search the photos instead" link
 *     carries them.
 *
 * Fuzzy reads the PERSON's name (`personNameFromParts`, the same derivation
 * stacks, sections and /people use), never the raw filename, so frame numbers
 * and file extensions cannot make a match. Callers decide what a fuzzy result
 * means on screen; the guest gallery and the editor both show the photos under
 * a "Did you mean …?" line with a way through to the visual search, because a
 * visual word can still land one edit from a name ("blue" / "blum").
 *
 * Pure and dependency-light: both callers are client components.
 */
import { foldName } from "@/lib/people/name-text";
import { displayName, personNameFromParts } from "@/lib/gallery/stacks";

export interface NameFields {
  parsedName?: string | null;
  originalFilename?: string | null;
}

export type NameSearchResult<T> =
  | { kind: "none"; items: [] ; suggestions: [] }
  | { kind: "exact"; items: T[]; suggestions: [] }
  | {
      kind: "fuzzy";
      items: T[];
      /** Display names of the people matched, most photos first. */
      suggestions: string[];
    };

/**
 * Search folding: full-width letters to normal ones (NFKC, so "ＳＴＡＣＹ"
 * from a Japanese keyboard reads "stacy"), then the shared accent and case
 * fold. Search-only: identity keys stay on `foldName` alone, which must
 * match SQL byte for byte.
 */
function fold(s: string): string {
  return foldName(s.normalize("NFKC"));
}

/** Letters and digits only: "O'Brien" → "obrien", "Mary-Ann" → "maryann". */
function compact(s: string): string {
  return s.replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Folded words: "Stacy Chen_26-10-20" → ["stacy","chen","26","10","20"].
 * Any script's letters count, so "王伟" and "Иван" are words.
 */
function words(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const HAS_LETTER = /\p{L}/u;

/**
 * Only Latin-script words are matched with edits. Other scripts are counted
 * wrongly by a letter-by-letter distance (NFD splits a Hangul syllable into
 * 2–3 jamo, a rare CJK character is two UTF-16 units), so they match exactly
 * or by their start, never "one edit off".
 */
const LATIN_WORD = /^\p{Script=Latin}+$/u;

/**
 * How many edits a query word may be from a name word. `inPhrase`: the query
 * has two or more words of 3+ letters. Every word of a query must land on the
 * SAME person, so a phrase cannot drift onto a stranger the way a lone short
 * word does, and that is what lets "stacy chan" find Stacy Chen and "jon
 * smith" find John Smith.
 */
export function allowedEdits(len: number, inPhrase = false): number {
  if (len < 3) return 0;
  if (len < 5) return inPhrase ? 1 : 0;
  if (len < 9) return 1;
  return 2;
}

/**
 * Edit distance where swapping two neighbouring letters counts as ONE edit
 * (optimal string alignment). Stops early once every path exceeds `max`, and
 * then returns max + 1.
 */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;
  const n = b.length;
  let prev2: number[] = new Array(n + 1).fill(0);
  let prev: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n];
}

/**
 * A typo almost never lands on a name's first letter, while a visual word one
 * letter from a name usually differs right there ("beach" / Leach, "banner" /
 * Tanner, "garden" / Cardenas: 6 of the 9 left after the limits above). So a
 * fuzzy match keeps the first letter, except C and K, which people swap in
 * names (Catherine / Katherine).
 */
function sameInitial(a: string, b: string): boolean {
  const k = (c: string) => (c === "c" ? "k" : c);
  return k(a[0]) === k(b[0]);
}

/** Shortest word still being typed that is compared against name-word starts. */
const MIN_PARTIAL = 6;

/**
 * How far one query word is from the closest word of a name, or null when no
 * word is close enough. The start of a name word always counts as a match.
 * When `typing` (the query's last word), a long enough word is also compared
 * at its own length, so a half-typed word ("christoph" for "christopher") is
 * judged on what has been typed so far.
 */
function wordDistance(
  q: string,
  nameWords: string[],
  typing: boolean,
  inPhrase: boolean
): number | null {
  const max = LATIN_WORD.test(q) ? allowedEdits(q.length, inPhrase) : 0;
  let best: number | null = null;
  for (const w of nameWords) {
    if (w.startsWith(q)) return 0;
    if (max === 0 || !sameInitial(q, w)) continue;
    const d = Math.min(
      editDistance(q, w, max),
      typing && q.length >= MIN_PARTIAL && w.length > q.length
        ? editDistance(q, w.slice(0, q.length), max)
        : max + 1
    );
    if (d <= max && (best === null || d < best)) best = d;
  }
  return best;
}

/**
 * A name's words for fuzzy matching, plus neighbours joined, so "obrien"
 * meets "O Brien" and "delacruz" meets "De La Cruz" (pairs and triples).
 */
function nameWordsOf(name: string): string[] {
  const ws = words(name).filter((w) => HAS_LETTER.test(w));
  const out = [...ws];
  for (let i = 0; i + 1 < ws.length; i++) {
    out.push(ws[i] + ws[i + 1]);
    if (i + 2 < ws.length) out.push(ws[i] + ws[i + 1] + ws[i + 2]);
  }
  return out;
}

/** Query words for fuzzy matching: whitespace-separated, punctuation dropped. */
function fuzzyQueryWords(query: string): string[] {
  return fold(query).split(/\s+/).map(compact).filter(Boolean);
}

/** Total distance of a whole query from a name, or null when any word misses. */
export function nameDistance(queryWords: string[], name: string): number | null {
  const nameWords = nameWordsOf(name);
  if (nameWords.length === 0) return null;
  const inPhrase = queryWords.filter((q) => q.length >= 3).length >= 2;
  let total = 0;
  for (let i = 0; i < queryWords.length; i++) {
    const d = wordDistance(queryWords[i], nameWords, i === queryWords.length - 1, inPhrase);
    if (d === null) return null;
    total += d;
  }
  return total;
}

/**
 * Per-photo derived text, computed once per photo object: folding every photo
 * on every keystroke, and deriving every person's name on a miss, are most of
 * a search's cost, and a gallery's photo objects live as long as its payload
 * does. The inputs are kept beside the results, so a photo renamed in place is
 * derived again rather than answered from the cache.
 */
interface Derived {
  pn: string;
  fn: string;
  /** Folded name and folded filename, as typed: the old rule reads each. */
  fpn: string;
  ffn: string;
  /** Every word of either field. */
  words: string[];
  /**
   * Runs of 2–4 neighbouring words joined, within ONE field:
   * "Juan De La Cruz" → juande, dela, lacruz, juandela, delacruz, juandelacruz.
   * A punctuation-free query word that spans words must EQUAL one of these.
   * A prefix is not enough: "bench" starts Ben + Chen and "dog" starts
   * Do + Gia, while a half-typed "obri" is caught by the fuzzy tier anyway.
   * Within one field, so a surname cannot glue onto the filename's first name
   * ("gray" in Lang + Raymond).
   */
  spans: Set<string>;
  name?: string;
}

const MAX_SPAN = 4;
function spansOf(field: string, out: Set<string>): void {
  const ws = words(field);
  for (let i = 0; i < ws.length; i++) {
    let joined = ws[i];
    for (let j = i + 1; j < ws.length && j < i + MAX_SPAN; j++) {
      joined += ws[j];
      out.add(joined);
    }
  }
}
const derivedCache = new WeakMap<object, Derived>();
function derived<T>(item: T, f: NameFields): Derived {
  const pn = f.parsedName ?? "";
  const fn = f.originalFilename ?? "";
  const key = typeof item === "object" && item !== null ? (item as object) : null;
  const hit = key ? derivedCache.get(key) : undefined;
  if (hit && hit.pn === pn && hit.fn === fn) return hit;
  const spans = new Set<string>();
  spansOf(pn, spans);
  spansOf(fn, spans);
  const d: Derived = {
    pn,
    fn,
    fpn: fold(pn),
    ffn: fold(fn),
    words: [...words(pn), ...words(fn)],
    spans,
  };
  if (key) derivedCache.set(key, d);
  return d;
}
function personName(d: Derived): string {
  if (d.name === undefined) d.name = personNameFromParts(d.pn || null, d.fn);
  return d.name;
}

export function searchByName<T>(
  items: readonly T[],
  query: string,
  fields: (item: T) => NameFields
): NameSearchResult<T> {
  // ── Exact ──
  // A photo matches when any of these holds:
  //  (a) the whole query is inside its name or inside its filename, as typed:
  //      the old rule, field by field, so nothing that used to match stops
  //      ("1020" finds frame 1020, "acy ch" finds Stacy Chen, "_" still works);
  //  (b) one word typed: punctuation dropped, it is a name form, i.e. it
  //      starts a word or equals neighbouring words joined ("obrien" →
  //      O'Brien, "maryann" → Mary-Ann);
  //  (c) several words typed: EACH is a name form, in any order ("chen
  //      stacy", "lisa obrien"); or, spaces dropped, the whole query is one
  //      ("de la cruz" → Delacruz, "mary ann" → Maryann).
  // Starts and equals, never anywhere-inside: as loose substrings "old man"
  // found Harold Bowman, and an exact hit hides the AI search with no link
  // through. Only words with letters are name forms; a digit word in a phrase
  // must start a word and be 3+ digits long (a frame number), because every
  // SPS filename carries the date words 26, 10 and 20.
  const whole = fold(query).trim();
  if (!whole) return { kind: "none", items: [], suggestions: [] };
  const tokens = whole.split(/\s+/).map(compact).filter(Boolean);
  const joinedQuery = compact(whole);
  const nameForm = (d: Derived, bare: string) =>
    HAS_LETTER.test(bare) && (d.spans.has(bare) || d.words.some((w) => w.startsWith(bare)));
  const tokenForm = (d: Derived, bare: string) =>
    HAS_LETTER.test(bare)
      ? nameForm(d, bare)
      : bare.length >= 3 && d.words.some((w) => w.startsWith(bare));
  const exact = items.filter((item) => {
    const d = derived(item, fields(item));
    if (d.fpn.includes(whole) || d.ffn.includes(whole)) return true;
    if (tokens.length === 0) return false;
    if (tokens.length === 1) return nameForm(d, tokens[0]);
    return tokens.every((t) => tokenForm(d, t)) || nameForm(d, joinedQuery);
  });
  if (exact.length > 0) return { kind: "exact", items: exact, suggestions: [] };

  // ── Fuzzy: close to a word of the person's name ──
  // Only a query that has letters can be a name ("2409" is a frame number).
  const queryWords = fuzzyQueryWords(query);
  if (!queryWords.some((q) => HAS_LETTER.test(q))) {
    return { kind: "none", items: [], suggestions: [] };
  }
  const byName = new Map<string, number | null>(); // derived name → distance
  const scored: { item: T; name: string; d: number }[] = [];
  let best = Infinity;
  for (const item of items) {
    const name = personName(derived(item, fields(item)));
    if (!name) continue;
    let d = byName.get(name);
    if (d === undefined) {
      d = nameDistance(queryWords, name);
      byName.set(name, d);
    }
    if (d === null) continue;
    scored.push({ item, name, d });
    if (d < best) best = d;
  }
  if (scored.length === 0) return { kind: "none", items: [], suggestions: [] };
  const kept = scored.filter((s) => s.d === best);

  // One suggestion per person (folded, so "stacy chen" and "Stacy Chen" are
  // one), ordered by how many photos they have.
  const people = new Map<string, { label: string; count: number }>();
  for (const s of kept) {
    const key = words(s.name).join(" ");
    const p = people.get(key);
    if (p) p.count++;
    else people.set(key, { label: displayName(s.name), count: 1 });
  }
  const suggestions = [...people.values()]
    .sort((a, b) => b.count - a.count)
    .map((p) => p.label);

  return { kind: "fuzzy", items: kept.map((s) => s.item), suggestions };
}
