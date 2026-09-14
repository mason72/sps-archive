/**
 * How a person's name is read as TEXT — the one home for Unicode in names.
 *
 * Until 2026-09-11 every name rule assumed ASCII: `[A-Za-z]` word shapes and
 * `[^a-z]` keys. "Cassandra Córdova" failed the person-name test and never
 * reached /people, and neither did any Muñoz, Wächter or Nguyễn — 66 distinct
 * names across 4,945 photos, found the day 911 garbled filenames were
 * repaired back to their real spellings (lesson 133). Nothing errored; the
 * people simply were not there.
 *
 * Two jobs, deliberately different:
 *   - SHAPE tests ("is this a name?") read real letters — Latin script with
 *     its accents, combining marks allowed — on NFC text (`nameText`).
 *   - KEYS ("is this the same name?") fold to plain a–z, so "Córdova",
 *     "Cordova" and a Mac export's decomposed "Co◌́rdova" are one person
 *     (`normalizeNameKey` in index-people.ts, built on `foldName`). The key
 *     stays ASCII on purpose: `person_name_key()` (migration 081) mints the
 *     same key in SQL for the reference faces, and the two must agree byte
 *     for byte — `npx tsx scripts/triage/name-key-parity.ts` checks them
 *     against each other. A name with no Latin letters at all keys to nothing
 *     and stays off the wall, exactly as before (measured: none in the
 *     archive on 2026-09-11).
 *
 * Folding uses NFD (canonical: a letter and its accents), NOT NFKD, which
 * also turns symbols into letters — "Twitch™" would key as "twitchtm" and
 * split from "Twitch". With NFD the key is exactly the old rule plus accents.
 *
 * Pure and dependency-free: the client event page imports the People index.
 */

/**
 * Letters NFD leaves whole, folded the way they are typed without the key.
 * Both cases are listed, so the fold never depends on a locale's lowercasing
 * — `person_name_key()` in SQL carries this same table.
 */
export const UNDECOMPOSED_FOLDS: Readonly<Record<string, string>> = {
  Ø: "o", ø: "o", Ł: "l", ł: "l", Đ: "d", đ: "d", Ð: "d", ð: "d",
  Ħ: "h", ħ: "h", Ŧ: "t", ŧ: "t", Ŋ: "n", ŋ: "n", ı: "i", ĸ: "k",
  ß: "ss", ẞ: "ss", Æ: "ae", æ: "ae", Œ: "oe", œ: "oe", Þ: "th", þ: "th",
};
const UNDECOMPOSED = new RegExp(`[${Object.keys(UNDECOMPOSED_FOLDS).join("")}]`, "g");

/**
 * Accent- and ligature-folded with CASE KEPT: "José García" → "Jose Garcia",
 * "ØRSTED" → "ORSTED", "Ærø" → "AEro". For text a person reads where only
 * plain letters survive — download filenames and ZIP folders. On plain ASCII
 * it is the identity.
 */
export function foldAccents(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(UNDECOMPOSED, (c) =>
      c === c.toLowerCase() ? UNDECOMPOSED_FOLDS[c] : UNDECOMPOSED_FOLDS[c].toUpperCase()
    );
}

/**
 * Accent-, case- and ligature-folded, everything else kept:
 * "Nájera-Smith" → "najera-smith", "Søren" → "soren". For comparisons that
 * still want word boundaries (search boxes, the face engine's name groups).
 * On plain ASCII it is exactly `toLowerCase()`. Byte-identical to the fold
 * `person_name_key()` performs in SQL, so change neither alone.
 */
export function foldName(s: string): string {
  return foldAccents(s).toLowerCase();
}

/**
 * The form every name derivation reads: NFC (so a decomposed Mac export and a
 * typed "ó" are the same string), minus the stray symbols some exports put in
 * front of a name — "✓ClaraHowell", "￼EdJackson" (U+FFFC, a pasted-object
 * placeholder), "©DCP". Leading whitespace is left for the callers' own trims.
 */
export function nameText(s: string): string {
  return s.normalize("NFC").replace(/^[\p{S}\p{C}]+/u, "");
}

/**
 * A fused name split at its case boundaries: "CassandraCórdova" →
 * "Cassandra Córdova", "TaísSales" → "Taís Sales". The Unicode twin of the
 * old `([a-z])([A-Z])` split, which could not see the boundary after an
 * accented letter. Marks riding on the lowercase letter stay with it.
 *
 * Three name shapes a bare case split got wrong (measured on the /people wall
 * 2026-09-14, lesson 149). None of them changes a letter, so no identity key moves:
 *  - **Mc / Mac stay on their surname**: "CollinMcFarlane" → "Collin McFarlane",
 *    not "Collin Mc Farlane" (138 cards). Only a boundary this split would
 *    make is kept shut; a space the filename typed is left alone.
 *  - **An initial is its own word**: "DavidJBoyle" → "David J Boyle",
 *    "KyleJ.Rose" → "Kyle J. Rose". EXCEPT a lone O or D, which is an
 *    apostrophe the export dropped ("RyanONeil", "KevinDSilva"): splitting it
 *    would read "Ryan O Neil", so it stays on the surname.
 *  - The same rule reads a two-letter initial run ("JRTreto" → "JR Treto").
 *    Only one or two capitals: a longer run is a shouted word whose boundary
 *    this cannot see, and splitting it gave "Amanda CHEROM Iah" and
 *    "VIVIA Nanderson" (caught in the wall diff), so it is left as typed.
 */
export function splitCamel(s: string): string {
  return s
    .replace(/(\p{Ll}\p{M}*)(?=\p{Lu})/gu, (m, _lower: string, offset: number, str: string) =>
      /(?:^|[^\p{Lu}])Ma?c$/u.test(str.slice(0, offset + m.length)) ? m : `${m} `
    )
    .replace(/(^|\s)((?![OD]\p{Lu}\p{Ll})\p{Lu}{1,2})(?=\p{Lu}\p{Ll})/gu, "$1$2 ")
    .replace(/(^|\s)(\p{Lu}\.)(?=\p{Lu}\p{Ll})/gu, "$1$2 ");
}

/**
 * Every maximal run of plain ASCII letters in a spelling, longest first:
 * "Molly O’Neill" → ["Molly", "Neill", "O"], "Córdova" → ["rdova", "C"].
 *
 * A run is text EVERY encoding of that spelling carries verbatim — the NFC
 * form, the decomposed Mac form, and the accent-free spelling — which is what
 * makes it safe as a SQL `ilike` candidate token. The old token stripped
 * non-letters out of the middle of the word instead ("Crdova", "ONeill"),
 * which matched none of them.
 */
export function asciiLetterRuns(s: string): string[] {
  return (s.normalize("NFC").match(/[A-Za-z]+/g) ?? []).sort(
    (a, b) => b.length - a.length
  );
}

/**
 * The `ilike` tokens that find one spelling's files, whichever way they were
 * encoded. Normally the longest plain-letter run. A short accented name can
 * have no run of two ("Lê Hà", "Đỗ Ái" — which then opened to an empty
 * spotlight, caught in review), so it falls back to its longest word in all
 * three encodings: composed, decomposed, and folded ("Lê", "Le◌̂", "le").
 * Letters and marks only, so nothing can break PostgREST's inline `or`.
 */
export function ilikeTokens(s: string): string[] {
  const run = asciiLetterRuns(s)[0];
  if (run && run.length >= 2) return [run];
  const word = (s.normalize("NFC").match(/[\p{L}\p{M}]+/gu) ?? []).sort(
    (a, b) => b.length - a.length
  )[0];
  if (!word) return [];
  return [...new Set([word, word.normalize("NFD"), foldName(word)])].filter(Boolean);
}
