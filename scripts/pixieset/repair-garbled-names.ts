/**
 * Repair photo names that the Pixieset ingest garbled into `?`s.
 *
 *   npx tsx scripts/pixieset/repair-garbled-names.ts <eventId> <zip> [<zip> ...]           # report only
 *   npx tsx scripts/pixieset/repair-garbled-names.ts <eventId> <zip> [<zip> ...] --apply   # write
 *
 * WHY. Until 2026-09-11 the ingest took each photo's name from `unzip -Z1`, which
 * prints every byte it cannot render as a literal `?`. `AndreasLöcher_….jpg` was
 * stored as `AndreasLo??cher_….jpg`, and that is the name the People index,
 * stacks, search and guest downloads all read. 911 rows across 15 events carried
 * one on the day it was found. The BYTES were always right — `readEntry` proves a
 * unique match before reading — only the recorded name was wrong.
 *
 * It surfaced as a stalled migration: the release sweep compares ZIP names to
 * event names before deleting a ZIP, found 83 "missing", failed closed, and
 * pinned 45 GB — which held the disk under the downloader's start floor, so
 * nothing new was requested for 37 hours.
 *
 * HOW A MATCH IS PROVEN. The garbling is deterministic: UTF-8-encode the real
 * name, replace every byte above 0x7F with `?`. A row is repaired only when
 * EXACTLY ONE real name in the archive garbles to its stored name, byte for byte
 * — not a fuzzy match, and not a count (a count-based guard is not a presence
 * guard). Anything unmatched, ambiguous, or colliding with a name the event
 * already holds is reported and left alone.
 *
 * Every change is written to ~/pixieset-staging/logs/ (id, old, new) BEFORE the
 * first update, and each update is a compare-and-set on the old name, so a row
 * someone changed in the meantime is skipped rather than clobbered.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFilename } from "../../src/lib/upload/parse-filename";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const JPEG = /\.(jpe?g)$/i;

/** What `unzip -Z1` prints for a name: every non-ASCII byte becomes a `?`. */
export function garble(name: string): string {
  return [...Buffer.from(name, "utf8")].map((b) => (b > 0x7f ? "?" : String.fromCharCode(b))).join("");
}

/** Real entry names, decoded per the ZIP spec. See px-filecheck.ts for why not unzip/bsdtar. */
function namelist(zip: string): string[] {
  const out = execFileSync(
    "python3",
    ["-c", "import sys,zipfile\nfor n in zipfile.ZipFile(sys.argv[1]).namelist(): sys.stdout.write(n+chr(10))", zip],
    { encoding: "utf8", maxBuffer: 1 << 28 },
  );
  return out.split("\n").filter(Boolean);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const [eventId, ...zips] = process.argv.slice(2).filter((a) => a !== "--apply");
  if (!eventId || !zips.length) {
    console.error("usage: repair-garbled-names.ts <eventId> <zip> [<zip> ...] [--apply]");
    process.exit(2);
  }

  // garbled form → every real name that produces it
  const byGarble = new Map<string, Set<string>>();
  for (const z of zips) {
    for (const entry of namelist(z)) {
      const base = path.basename(entry);
      if (!JPEG.test(base)) continue;
      const g = garble(base);
      if (g === base) continue;                           // pure ASCII — never garbled
      if (!byGarble.has(g)) byGarble.set(g, new Set());
      byGarble.get(g)!.add(base.normalize("NFC"));
    }
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const rows: { id: string; original_filename: string; parsed_name: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images")
      .select("id, original_filename, parsed_name")
      .eq("event_id", eventId)
      .order("id", { ascending: true })                 // lesson 88: every paged read orders on a unique column
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const held = new Set(rows.map((r) => (r.original_filename ?? "").normalize("NFC")));
  const garbledRows = rows.filter((r) => r.original_filename?.includes("?"));

  const plan: { id: string; old: string; next: string; oldParsed: string | null; nextParsed: string }[] = [];
  const unmatched: string[] = [], ambiguous: string[] = [], collides: string[] = [];
  for (const r of garbledRows) {
    const cands = byGarble.get(r.original_filename);
    if (!cands) { unmatched.push(r.original_filename); continue; }
    if (cands.size !== 1) { ambiguous.push(`${r.original_filename} → ${[...cands].join(" | ")}`); continue; }
    const next = [...cands][0];
    if (held.has(next)) { collides.push(`${r.original_filename} → ${next} (already in the event)`); continue; }
    plan.push({ id: r.id, old: r.original_filename, next, oldParsed: r.parsed_name, nextParsed: parseFilename(next).name });
  }
  // Two rows garbling to one real name would become duplicates — refuse both.
  const counts = new Map<string, number>();
  for (const p of plan) counts.set(p.next, (counts.get(p.next) ?? 0) + 1);
  const safe = plan.filter((p) => counts.get(p.next) === 1);
  for (const p of plan) if (counts.get(p.next)! > 1) collides.push(`${p.old} → ${p.next} (${counts.get(p.next)} rows want this name)`);

  console.log(`event ${eventId}: ${rows.length} rows, ${garbledRows.length} with "?" | repairable ${safe.length} · unmatched ${unmatched.length} · ambiguous ${ambiguous.length} · colliding ${collides.length}`);
  for (const p of safe.slice(0, 5)) console.log(`  ${p.old}  →  ${p.next}   (parsed_name ${JSON.stringify(p.oldParsed)} → ${JSON.stringify(p.nextParsed)})`);
  for (const [label, list] of [["unmatched", unmatched], ["ambiguous", ambiguous], ["colliding", collides]] as const) {
    for (const x of list.slice(0, 5)) console.log(`  ${label}: ${x}`);
  }
  if (!apply) { console.log("report only — pass --apply to write."); return; }
  if (!safe.length) return;

  const logDir = path.join(os.homedir(), "pixieset-staging", "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `name-repairs-${eventId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ eventId, at: new Date().toISOString(), changes: safe }, null, 2));
  console.log(`logged ${safe.length} change(s) to ${logFile}`);

  let wrote = 0, skipped = 0, failed = 0;
  for (const p of safe) {
    const { data, error } = await sb
      .from("images")
      .update({ original_filename: p.next, parsed_name: p.nextParsed })
      .eq("id", p.id)
      .eq("original_filename", p.old)                     // compare-and-set: never clobber a row changed since the read
      .select("id");
    if (error) { failed++; console.error(`  FAILED ${p.id}: ${error.message}`); continue; }
    if (!data?.length) { skipped++; continue; }
    wrote++;
  }
  console.log(`wrote ${wrote} · skipped (changed since read) ${skipped} · failed ${failed}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
