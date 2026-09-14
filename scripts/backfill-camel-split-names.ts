/**
 * Re-derive parsed names the old CamelCase branch got wrong (lesson 147).
 *
 * Until 2026-09-14 parseFilename() read a single fused part by collecting
 * `Upper+lower` runs. It dropped every other letter ("LisaOBrien" → "Lisa
 * Brien", "ShannonD'Arcangelo" → "Shannon Arcangelo"), left three-word names
 * fused ("KateyStJohn"), and kept "edited"/"retouched" in the name. The parser
 * now splits through `splitPersonWords`; this brings the stored column along.
 *
 * A row is a candidate ONLY when the stored parsed_name is exactly what the
 * OLD parser (frozen below) makes of its filename, and the new parser makes
 * something else. That is the one transformation this fix caused, so names a
 * human typed, and values an older parser wrote, are left alone.
 *
 * Two classes, because they need different permission:
 *  - key unchanged: spacing only ("KateyStJohn" → "Katey St John"). The
 *    /people identity cannot move (lesson 141's guard). Written by --apply.
 *  - key moves ("Lisa Brien" → "Lisa OBrien"): the person joins the right
 *    card, which also detaches anything stored against the wrong key. Written
 *    only with --apply --move-keys, after the moved keys have been checked
 *    against every identity table and approved.
 *
 *   npx tsx scripts/backfill-camel-split-names.ts                         # dry run
 *   npx tsx scripts/backfill-camel-split-names.ts --apply                 # key-neutral rows
 *   npx tsx scripts/backfill-camel-split-names.ts --apply --move-keys     # both classes
 *   NAME_ROWS=<file> …   plan from a local row copy (name-parse-key-diff.ts rows); writes still re-check the row
 *   --keys <out.json>    write the moved key pairs, for the identity-table check
 *
 * Undo: the ledger stores [id, old parsed_name] pairs, written before the
 * first update. ⚠️ .env.local points at PRODUCTION.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseFilename } from "@/lib/upload/parse-filename";
import { collapseRepeatedWords } from "@/lib/gallery/stacks";
import { personKeyForImage } from "@/lib/people/index-people";
import { nameText } from "@/lib/people/name-text";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be populated.
}

const arg = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const APPLY = process.argv.includes("--apply");
const MOVE_KEYS = process.argv.includes("--move-keys");
const LEDGER = arg("--ledger") ?? "tasks/backfill-camel-split-names-2026-09-14.json";
const KEYS_OUT = arg("--keys");
const PAGE = 1000;
const CONCURRENCY = 4;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = { id: string; parsed_name: string | null; original_filename: string };

/**
 * parseFilename's name as of 3bbcb49 (the last commit before this fix),
 * frozen. Only the name, and only the two branches that changed: the noise
 * words and the CamelCase split. Camera frames and empty names return null
 * through the live parser, which did not change for them.
 */
function oldParsedName(filename: string): string | null {
  const current = parseFilename(filename);
  if (current.name === null) return null;
  const parts = nameText(current.stem).split(/[_\- ]+/).filter(Boolean);
  const nameParts = parts.filter(
    (p) => !/^\d+$/.test(p) && !/^(headshot|portrait|photo|final|edit|raw|web|print)$/i.test(p)
  );
  if (nameParts.length === 0) return null;
  if (nameParts.length === 1 && /^\p{Lu}[\p{Ll}\p{M}]+\p{Lu}/u.test(nameParts[0])) {
    const camelParts = nameParts[0].match(/\p{Lu}[\p{Ll}\p{M}]+/gu);
    if (camelParts && camelParts.length === 2) return `${camelParts[0]} ${camelParts[1]}`;
  }
  return collapseRepeatedWords(nameParts.join(" ")) || null;
}

async function readRows(): Promise<Row[]> {
  if (process.env.NAME_ROWS) return JSON.parse(fs.readFileSync(process.env.NAME_ROWS, "utf8")) as Row[];
  const rows = new Map<string, Row>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("images")
      .select("id, parsed_name, original_filename")
      .not("parsed_name", "is", null)
      // Paged reads need a unique order, or pages overlap (lesson 88).
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read failed at offset ${from}: ${error.message}`);
    for (const r of data ?? []) rows.set(r.id, r as Row);
    if (!data || data.length < PAGE) break;
  }
  return [...rows.values()];
}

async function main() {
  type Plan = { id: string; old: string; name: string; file: string; from: string; to: string };
  const neutral: Plan[] = [];
  const moving: Plan[] = [];
  let candidates = 0;
  for (const r of await readRows()) {
    if (!r.parsed_name) continue;
    const name = parseFilename(r.original_filename).name;
    if (!name || name === r.parsed_name || oldParsedName(r.original_filename) !== r.parsed_name) continue;
    candidates += 1;
    const from = personKeyForImage(r.parsed_name, r.original_filename);
    const to = personKeyForImage(name, r.original_filename);
    const p = { id: r.id, old: r.parsed_name, name, file: r.original_filename, from, to };
    (from === to ? neutral : moving).push(p);
  }

  console.log(`candidates ${candidates} · key unchanged ${neutral.length} · key moves ${moving.length}`);
  for (const p of neutral.slice(0, 8)) console.log(`  same key  ${p.file}  ${JSON.stringify(p.old)} → ${JSON.stringify(p.name)}`);
  const pairs = new Map<string, { n: number; eg: Plan }>();
  for (const p of moving) {
    const k = `${p.from} → ${p.to}`;
    pairs.set(k, { n: (pairs.get(k)?.n ?? 0) + 1, eg: p });
  }
  console.log(`\nkey moves: ${pairs.size} distinct pairs`);
  for (const [k, v] of [...pairs].sort((a, b) => b[1].n - a[1].n))
    console.log(`  ${String(v.n).padStart(4)}  ${k.padEnd(52)} ${JSON.stringify(v.eg.old)} → ${JSON.stringify(v.eg.name)}  ${v.eg.file}`);
  if (KEYS_OUT) {
    fs.writeFileSync(KEYS_OUT, JSON.stringify([...pairs].map(([k, v]) => ({ pair: k, n: v.n, from: v.eg.from, to: v.eg.to }))));
    console.log(`moved key pairs → ${KEYS_OUT}`);
  }

  if (!APPLY) {
    console.log("\nDry run. --apply writes the key-unchanged rows; add --move-keys for the rest.");
    return;
  }
  const plan = MOVE_KEYS ? [...neutral, ...moving] : neutral;

  // Ledger FIRST, so an interrupted run still leaves its undo record.
  fs.writeFileSync(LEDGER, JSON.stringify(plan.map((p) => [p.id, p.old])));

  let written = 0;
  let raced = 0;
  const failures: string[] = [];
  let next = 0;
  async function worker() {
    while (next < plan.length) {
      const p = plan[next++];
      const { data, error } = await db
        .from("images")
        .update({ parsed_name: p.name })
        .eq("id", p.id)
        .eq("parsed_name", p.old)
        .select("id");
      if (error) failures.push(`${p.id}: ${error.message}`);
      else if (!data?.length) raced += 1; // changed since the read; leave it
      else written += 1;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nwritten ${written} · changed meanwhile (left alone) ${raced} · failed ${failures.length}`);
  console.log(`undo ledger: ${LEDGER}`);
  if (failures.length) {
    console.error(failures.slice(0, 20).join("\n"));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
