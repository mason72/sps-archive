/**
 * Do the two person keys agree?
 *
 * `normalizeNameKey()` (TypeScript — the /people wall, exclusions, aliases)
 * and `person_name_key()` (SQL, migration 081 — the reference faces and the
 * exclusion check inside their refresh) must produce the same key for every
 * name. When they drift, an exclusion stops reaching that name's reference
 * faces and suggestions carry a key the wall does not know — silently, for
 * exactly the names that differ.
 *
 * Compares them on every named cluster, every non-ASCII filename stem and
 * every decomposed (NFD) filename in the archive, plus a synthetic set that
 * uses each letter of the fold table: real names alone never contain an Ħ,
 * which is how a miscounted translate() string would survive every other
 * check. A control line proves the comparison can see a difference.
 * Read-only.
 *
 *   npx tsx scripts/triage/name-key-parity.ts
 *
 * Exits 1 on any disagreement.
 */
import { execFileSync } from "node:child_process";

import { normalizeNameKey } from "../../src/lib/people/index-people";
import { UNDECOMPOSED_FOLDS } from "../../src/lib/people/name-text";

const SYNTHETIC = [
  ...Object.keys(UNDECOMPOSED_FOLDS).map((c) => `A${c}b ${c}z`),
  "İstanbul Öztürk",
  "ﬁona Ｗｉｄｅ", // a ligature and full-width letters: NFD leaves them, both sides drop them
  "Twitch™ Nº ª", // symbols NFKD would turn into letters; NFD must not
  "Córdova Nguyễn", // decomposed
  "José García-Márquez",
  "Brendan O’Gibney",
  "Łódź Ǆemal",
  "Алёна Аксёнова", // no Latin letters: both sides must say ""
];

const sql = `
with v(n) as (
  select distinct name from persons where name is not null
  union select distinct split_part(original_filename, '_', 1) from images
        where original_filename ~ '[^\\x01-\\x7F]'
  union select distinct original_filename from images
        where original_filename <> normalize(original_filename, NFC)
  union select json_array_elements_text($j$${JSON.stringify(SYNTHETIC)}$j$::json)
)
select n, person_name_key(n) as k from v`;

const out = execFileSync("npx", ["tsx", "scripts/db-sql.ts", "--query", sql], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
});
const rows = JSON.parse(out) as { n: string; k: string }[];
if (!Array.isArray(rows) || rows.length === 0) {
  // An empty answer is a broken probe, not a pass.
  console.error("no rows came back — the probe is broken, not the keys");
  process.exit(1);
}

const oldRule = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const mismatches = rows.filter((r) => normalizeNameKey(r.n) !== r.k);
const nonAscii = rows.filter((r) => /[^\x01-\x7F]/.test(r.n));
const controlDiffs = nonAscii.filter((r) => oldRule(r.n) !== r.k).length;

console.log(`compared ${rows.length} names (${nonAscii.length} non-ASCII, ${SYNTHETIC.length} synthetic)`);
console.log(`control: the OLD ASCII rule disagrees with SQL on ${controlDiffs} of them — the check can see a difference`);
if (mismatches.length) {
  console.error(`\n${mismatches.length} DISAGREEMENT(S):`);
  for (const r of mismatches.slice(0, 40)) {
    console.error(`  ${JSON.stringify(r.n)}  ts=${normalizeNameKey(r.n)}  sql=${r.k}`);
  }
  process.exit(1);
}
console.log("OK — TypeScript and SQL agree on every name");
