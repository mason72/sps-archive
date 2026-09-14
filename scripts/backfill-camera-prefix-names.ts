/**
 * Backfill parsed_name for rows the old camera-prefix rule wrongly nulled.
 *
 * Until 2026-09-14 `CAMERA_PREFIXES` in src/lib/upload/parse-filename.ts was a
 * bare prefix, so `P` matched every name starting with p and `SAM` every
 * Samantha. 5,194 rows ("Patricia Smith_26-04-14_CollegeBoard_0101.jpg") stored
 * parsed_name NULL and showed a name only through the filename fallback in
 * personNameFromParts().
 *
 * One guard decides what is written: a row is updated ONLY if its person key
 * (personKeyForImage) is identical before and after. That makes the backfill a
 * no-op for /people identity by construction — aliases, rejections, split links
 * and crew links are all keyed on that value. Measured on the day, it skips 75
 * rows: 14 of Patrick Strozzo's (the compact `_260603_` date lets
 * "FMheadshots" into the parsed name) and 61 non-people files (PE_Wed,
 * photobooth). Mason chose this over writing all 5,194.
 *
 * The write also requires parsed_name to still be NULL, so a name a human set
 * in the meantime is never overwritten, and re-running is idempotent.
 *
 *   npx tsx scripts/backfill-camera-prefix-names.ts            # dry run
 *   npx tsx scripts/backfill-camera-prefix-names.ts --apply    # write
 *
 * Undo: every written id is saved to --ledger (default beside this script's
 * run in tasks/). The old value was NULL for all of them, so reverting is
 * `update images set parsed_name = null where id in (<ledger>)`.
 *
 * ⚠️ .env.local points at PRODUCTION.
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
    : "tasks/backfill-camera-prefix-names-2026-09-14.ids.json";
const PAGE = 1000;
const CONCURRENCY = 4;

/** The letter prefixes the old rule matched bare (after SPS's "(AI) " marker). */
const AFFECTED = "^(\\(AI\\) *)?(p|sam|r0)";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
const db = createClient(url, key, { auth: { persistSession: false } });

type Row = { id: string; original_filename: string };

async function readCandidates(): Promise<Row[]> {
  const rows = new Map<string, Row>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("images")
      .select("id, original_filename")
      .is("parsed_name", null)
      .filter("original_filename", "imatch", AFFECTED)
      // Paged reads need a unique order, or pages overlap (lesson 88).
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`read failed at offset ${from}: ${error.message}`);
    for (const r of data ?? []) rows.set(r.id, r);
    if (!data || data.length < PAGE) break;
  }
  return [...rows.values()];
}

async function main() {
  const candidates = await readCandidates();
  const plan: { id: string; name: string; file: string }[] = [];
  const skipped: string[] = [];
  let stillCamera = 0;

  for (const r of candidates) {
    const name = parseFilename(r.original_filename).name;
    if (!name) {
      stillCamera += 1;
      continue;
    }
    if (personKeyForImage(null, r.original_filename) !== personKeyForImage(name, r.original_filename)) {
      skipped.push(r.original_filename);
      continue;
    }
    plan.push({ id: r.id, name, file: r.original_filename });
  }

  console.log(
    `candidates ${candidates.length} · still camera ${stillCamera} · ` +
      `skipped (key would change) ${skipped.length} · to write ${plan.length}`
  );
  for (const p of plan.slice(0, 8)) console.log(`  ${p.file}  →  ${JSON.stringify(p.name)}`);
  const skipCounts = new Map<string, number>();
  for (const f of skipped) {
    const k = f.replace(/[_-]?\d+.*$/, "");
    skipCounts.set(k, (skipCounts.get(k) ?? 0) + 1);
  }
  console.log("  skipped:", [...skipCounts].sort((a, b) => b[1] - a[1]));

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  // Ledger FIRST, so an interrupted run still leaves its undo record.
  fs.writeFileSync(LEDGER, JSON.stringify(plan.map((p) => p.id)));

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
        .is("parsed_name", null)
        .select("id");
      if (error) failures.push(`${p.id}: ${error.message}`);
      else if (!data?.length) raced += 1; // a human named it first
      else written += 1;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nwritten ${written} · already named (left alone) ${raced} · failed ${failures.length}`);
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
