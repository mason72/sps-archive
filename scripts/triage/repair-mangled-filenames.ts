/**
 * Repair `original_filename` values mangled by Info-ZIP's `unzip`.
 *
 * `unzip -Z1` cannot render non-ASCII filename bytes and substitutes `?` (or a
 * raw invalid byte — the exact substitution is LOCALE-DEPENDENT, which is why
 * the mangled form cannot be predicted from outside the process that produced
 * it). The ingest lists entries with `unzip -Z1`, so any photograph whose name
 * carries an accent or a curly apostrophe is stored with the damage baked in:
 * `NaniNa’ope` becomes `NaniNa???ope`. The BYTES are unaffected — only the label.
 *
 * This matters because /people derives identity from the filename, so a mangled
 * name produces a mangled person.
 *
 * The true names are read from each ZIP's central directory (which stores proper
 * UTF-8, flag bit 11 set) and captured to a JSON file BEFORE the archive is
 * released, because a released archive is deleted and the true name is then gone.
 *
 * Join key: the ASCII SKELETON — every non-ASCII character, every `?` and every
 * U+FFFD removed from both sides. The ASCII characters survive unzip's mangling
 * in order and in place, so the skeleton is stable no matter which substitution
 * the locale produced. Ambiguity is refused, never guessed.
 *
 *   npx tsx scripts/triage/repair-mangled-filenames.ts            dry run
 *   npx tsx scripts/triage/repair-mangled-filenames.ts --apply    write
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const APPLY = process.argv.includes("--apply");
const MAP = process.env.PIXIESET_TRUE_NAMES
  || path.join(process.env.PIXIESET_STAGING || path.join(os.homedir(), "pixieset-staging"), "true-filenames.json");

/** Strip everything unzip could have altered, leaving the stable ASCII spine. */
const skeleton = (s: string) => s.replace(/[^\x20-\x7E]/g, "").replace(/\?/g, "");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  if (!fs.existsSync(MAP)) {
    console.error(`no true-name map at ${MAP} — nothing to repair from.`);
    process.exit(1);
  }
  const rows: { zip: string; true: string }[] = JSON.parse(fs.readFileSync(MAP, "utf8"));
  const byKey = new Map<string, string[]>();
  for (const r of rows) {
    const base = path.basename(r.true);
    const k = skeleton(base);
    byKey.set(k, [...(byKey.get(k) ?? []), base]);
  }
  console.log(`true names loaded: ${rows.length} (${byKey.size} distinct skeletons)`);

  // every image whose stored name still carries a substitution character
  const damaged: { id: string; original_filename: string; event_id: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("images")
      .select("id,original_filename,event_id")
      .or("original_filename.like.%?%,original_filename.like.%�%")
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) { console.error("read failed:", error.message); process.exit(1); }
    damaged.push(...data);
    if (data.length < 1000) break;
  }
  console.log(`damaged rows in DB : ${damaged.length}`);

  let fixed = 0, ambiguous = 0, unmatched = 0, already = 0;
  for (const img of damaged) {
    const k = skeleton(img.original_filename);
    const hits = byKey.get(k);
    if (!hits) { unmatched++; console.log(`  UNMATCHED  ${img.original_filename}`); continue; }
    const uniq = [...new Set(hits)];
    if (uniq.length !== 1) { ambiguous++; console.log(`  AMBIGUOUS  ${img.original_filename} -> ${uniq.length} candidates`); continue; }
    if (uniq[0] === img.original_filename) { already++; continue; }
    console.log(`  ${img.original_filename}\n      -> ${uniq[0]}`);
    if (APPLY) {
      const { error } = await sb.from("images").update({ original_filename: uniq[0] }).eq("id", img.id);
      if (error) { console.error(`      UPDATE FAILED: ${error.message}`); continue; }
    }
    fixed++;
  }
  console.log(`\n${APPLY ? "repaired" : "would repair"}: ${fixed}   unmatched: ${unmatched}   ambiguous: ${ambiguous}   already correct: ${already}`);
  if (!APPLY) console.log("dry run — pass --apply to write.");
}
main();
