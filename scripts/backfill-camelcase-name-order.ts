/**
 * Rewrite "First, Last" parsed names to "First Last".
 *
 * Until 2026-09-14 parseFilename() read a CamelCase name as LastFirst and
 * stored "PatrickKrieger_26-01-27_2079.jpg" as "Patrick, Krieger". The studio
 * files FirstLast (confirmed with Mason; of 449 distinct names, 14 also appear
 * spaced First Last elsewhere and none reversed), so every stack label read
 * backwards. 7,134 rows carried ", " on the day (lesson 143).
 *
 * A row is rewritten ONLY when all three hold:
 *  - the current parser's name is exactly the stored name with ", " → " ".
 *    That is the one transformation this fix caused, so real commas
 *    ("Rahsaan Ellis, Jr.") and names a human typed onto a frame ("08.jpg" →
 *    "Dominique, Hollins") are left alone;
 *  - personKeyForImage is identical before and after (lesson 141's guard —
 *    aliases, exclusions, split links and crew links all key on it);
 *  - parsed_name still holds the value read, so a concurrent edit wins.
 *
 *   npx tsx scripts/backfill-camelcase-name-order.ts            # dry run
 *   npx tsx scripts/backfill-camelcase-name-order.ts --apply    # write
 *
 * Undo: the ledger stores [id, old parsed_name] pairs, written before the
 * first update. ⚠️ .env.local points at PRODUCTION.
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseFilename } from "@/lib/upload/parse-filename";
import { personKeyForImage } from "@/lib/people/index-people";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be populated.
}

const APPLY = process.argv.includes("--apply");
const ledgerIdx = process.argv.indexOf("--ledger");
const LEDGER =
  ledgerIdx !== -1
    ? process.argv[ledgerIdx + 1]
    : "tasks/backfill-camelcase-name-order-2026-09-14.json";
const PAGE = 1000;
const CONCURRENCY = 4;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = { id: string; parsed_name: string; original_filename: string };

async function readCandidates(): Promise<Row[]> {
  const rows = new Map<string, Row>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("images")
      .select("id, parsed_name, original_filename")
      .like("parsed_name", "%, %")
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
  const candidates = await readCandidates();
  const plan: { id: string; old: string; name: string; file: string }[] = [];
  const notOurs: Row[] = [];
  let keyWouldMove = 0;

  for (const r of candidates) {
    const name = parseFilename(r.original_filename).name;
    if (name !== r.parsed_name.replace(", ", " ")) {
      notOurs.push(r);
      continue;
    }
    if (personKeyForImage(r.parsed_name, r.original_filename) !== personKeyForImage(name, r.original_filename)) {
      keyWouldMove += 1;
      continue;
    }
    plan.push({ id: r.id, old: r.parsed_name, name, file: r.original_filename });
  }

  console.log(
    `candidates ${candidates.length} · not this parser's comma ${notOurs.length} · ` +
      `key would move ${keyWouldMove} · to write ${plan.length}`
  );
  for (const p of plan.slice(0, 6)) console.log(`  ${p.file}  ${JSON.stringify(p.old)} → ${JSON.stringify(p.name)}`);
  for (const r of notOurs.slice(0, 12)) console.log(`  left alone: ${r.original_filename}  ${JSON.stringify(r.parsed_name)}`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

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
