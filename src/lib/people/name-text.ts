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
 *   - SHAPE tests ("is this a name?") read real letters — `\p{L}`, with
 *     combining marks allowed — on NFC text (`nameText`).
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
 * Pure and dependency-free: the client event page imports the People index.
 */

/**
 * Letters NFKD leaves whole, folded the way they are typed without the key.
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
 * Accent-, case- and ligature-folded, everything else kept:
 * "Nájera-Smith" → "najera-smith", "Søren" → "soren". For comparisons that
 * still want word boundaries (search boxes, the stacks' cleaner).
 */
export function foldName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(UNDECOMPOSED, (c) => UNDECOMPOSED_FOLDS[c])
    .toLowerCase();
}

/**
 * The form every name derivation reads: NFC (so a decomposed Mac export and a
 * typed "ó" are the same string), minus the stray symbols some exports put in
 * front of a name — "✓ClaraHowell", "￼EdJackson" (U+FFFC, a pasted-object
 * placeholder), "©DCP".
 */
export function nameText(s: string): string {
  return s.normalize("NFC").replace(/^[\p{S}\p{C}\p{Z}]+/u, "");
}

/**
 * A fused name split at its case boundary: "CassandraCórdova" →
 * "Cassandra Córdova", "TaísSales" → "Taís Sales". The Unicode twin of the
 * old `([a-z])([A-Z])` split, which could not see the boundary after an
 * accented letter. Marks riding on the lowercase letter stay with it.
 */
export function splitCamel(s: string): string {
  return s.replace(/(\p{Ll}\p{M}*)(?=\p{Lu})/gu, "$1 ");
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
