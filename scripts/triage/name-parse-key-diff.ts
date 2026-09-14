/**
 * Snapshot the /people identity key of every row a filename-parser change can
 * touch, so a before/after pair proves which keys moved.
 *
 * Written 2026-09-14 for two parser fixes (lesson 143): CamelCase "FirstLast"
 * stored as "First, Last", and compact `_YYMMDD_` dates that were not a date
 * anchor. Run it on the OLD code, change the parser, run it again, compare:
 *
 *   npx tsx scripts/triage/name-parse-key-diff.ts dump  before.json
 *   npx tsx scripts/triage/name-parse-key-diff.ts dump  after.json
 *   npx tsx scripts/triage/name-parse-key-diff.ts compare before.json after.json
 *
 * Per row it records the key as stored today (`key`) and the key if
 * parsed_name were re-derived by the current parser (`reparsedKey`). Read-only.
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

type Row = { id: string; event_id: string; parsed_name: string | null; original_filename: string };
type Snap = Record<
  string,
  { eventId: string; file: string; parsed: string | null; reparsed: string | null; key: string; reparsedKey: string }
>;

const PAGE = 1000;

/**
 * `NAME_ROWS=<file>` reads rows from a local copy made by the `rows` command
 * instead of the database, so a before/after pair (and any offline shape
 * count) compares the SAME rows and costs one read of production, not three.
 * Without it, only the rows lesson 143's fixes could touch are read.
 */
async function read(all = false): Promise<Row[]> {
  if (!all && process.env.NAME_ROWS) {
    return JSON.parse(fs.readFileSync(process.env.NAME_ROWS, "utf8")) as Row[];
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const rows = new Map<string, Row>();
  const filters: [string, string, string][] = all
    ? [["original_filename", "neq", ""]]
    : [
        ["parsed_name", "like", "%, %"],
        ["original_filename", "match", "[0-9]{6}_"],
      ];
  for (const [col, op, val] of filters) {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("images")
        .select("id, event_id, parsed_name, original_filename")
        .filter(col, op, val)
        // Paged reads need a unique order, or pages overlap (lesson 88).
        .order("id")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`read ${col} failed at ${from}: ${error.message}`);
      for (const r of data ?? []) rows.set(r.id, r);
      if (!data || data.length < PAGE) break;
    }
  }
  return [...rows.values()];
}

async function dump(out: string) {
  const snap: Snap = {};
  for (const r of await read()) {
    const reparsed = parseFilename(r.original_filename).name;
    snap[r.id] = {
      eventId: r.event_id,
      file: r.original_filename,
      parsed: r.parsed_name,
      reparsed,
      key: personKeyForImage(r.parsed_name, r.original_filename),
      reparsedKey: personKeyForImage(reparsed, r.original_filename),
    };
  }
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`${Object.keys(snap).length} rows → ${out}`);
}

function compare(beforePath: string, afterPath: string) {
  const before: Snap = JSON.parse(fs.readFileSync(beforePath, "utf8"));
  const after: Snap = JSON.parse(fs.readFileSync(afterPath, "utf8"));
  let codeMoved = 0;
  let backfillSafe = 0;
  let backfillMoves = 0;
  const moves = new Map<string, { n: number; example: string }>();
  for (const [id, a] of Object.entries(after)) {
    const b = before[id];
    if (!b) continue;
    // Stored parsed_name, new code: a move here happens on deploy, backfill or not.
    if (a.key !== b.key) {
      codeMoved += 1;
      const k = `${b.key} → ${a.key}`;
      const m = moves.get(k) ?? { n: 0, example: a.file };
      m.n += 1;
      moves.set(k, m);
    }
    if (a.reparsed !== a.parsed) {
      if (a.reparsedKey === a.key) backfillSafe += 1;
      else backfillMoves += 1;
    }
  }
  console.log(
    `rows ${Object.keys(after).length} · key moved by code ${codeMoved} · ` +
      `backfill rewrites with key unchanged ${backfillSafe} · backfill would move key ${backfillMoves}`
  );
  for (const [k, m] of [...moves].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`  ${String(m.n).padStart(5)}  ${k}   e.g. ${m.example}`);
  }
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "rows" && a) {
  read(true)
    .then((rows) => {
      fs.writeFileSync(a, JSON.stringify(rows));
      console.log(`${rows.length} rows → ${a}`);
    })
    .catch((e) => { console.error(e); process.exit(1); });
} else if (cmd === "dump" && a) dump(a).catch((e) => { console.error(e); process.exit(1); });
else if (cmd === "compare" && a && b) compare(a, b);
else {
  console.error("usage: rows <out.json> | dump <out.json> | compare <before.json> <after.json>");
  process.exit(1);
}
