/**
 * Scratch: why does a /people tile promise N photos while the spotlight shows M?
 * Replicates BOTH membership paths and diffs the row sets:
 *   index path  — full scan, personKeyForImage in TS (what the tile counts)
 *   detail path — ilike candidate filter on the longest token, then same key test
 *
 *   npx tsx scripts/triage/person-count-diff.ts "Jenna Loeser"
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Usage: npx tsx scripts/triage/person-count-diff.ts "First Last"');

  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { personKeyForImage, normalizeNameKey, NON_PERSON_GALLERIES } = await import(
    "../../src/lib/people/index-people"
  );

  const supabase = createServiceClient();
  const key = normalizeNameKey(name);

  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id, name, event_date");
  if (evErr) throw evErr;
  const eventById = new Map(
    (events ?? []).filter((e) => !NON_PERSON_GALLERIES.has(e.name)).map((e) => [e.id, e])
  );
  const evName = (id: string) => eventById.get(id)?.name ?? id;

  type Row = {
    id: string;
    event_id: string;
    parsed_name: string | null;
    original_filename: string;
  };
  const PAGE = 1000;

  // --- Index path: full scan, no ilike ---
  const indexRows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("images")
      .select("id, event_id, parsed_name, original_filename")
      .in("event_id", [...eventById.keys()])
      .eq("media_type", "image")
      .eq("processing_status", "complete")
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Row[]) {
      if (personKeyForImage(r.parsed_name, r.original_filename) === key) indexRows.push(r);
    }
    if (data.length < PAGE) break;
  }

  // --- Detail path: ilike candidate filter, then same key test ---
  const token = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .sort((a, b) => b.length - a.length)[0];
  const detailRows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("images")
      .select("id, event_id, parsed_name, original_filename")
      .in("event_id", [...eventById.keys()])
      .eq("media_type", "image")
      .eq("processing_status", "complete")
      .or(`parsed_name.ilike.%${token}%,original_filename.ilike.%${token}%`)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data as Row[]) {
      if (personKeyForImage(r.parsed_name, r.original_filename) === key) detailRows.push(r);
    }
    if (data.length < PAGE) break;
  }

  console.log(`\n${name} (key=${key}, token=${token})`);
  console.log(`index path (tile):    ${indexRows.length}`);
  console.log(`detail path (card):   ${detailRows.length}`);

  const detailIds = new Set(detailRows.map((r) => r.id));
  const missing = indexRows.filter((r) => !detailIds.has(r.id));
  console.log(`\nIn tile but NOT in card: ${missing.length}`);
  for (const r of missing.slice(0, 40)) {
    console.log(
      `  ${r.id}  ev=${evName(r.event_id)}  parsed=${JSON.stringify(r.parsed_name)}  file=${r.original_filename}`
    );
  }

  const indexIds = new Set(indexRows.map((r) => r.id));
  const extra = detailRows.filter((r) => !indexIds.has(r.id));
  console.log(`\nIn card but NOT in tile: ${extra.length}`);
  for (const r of extra.slice(0, 40)) {
    console.log(
      `  ${r.id}  ev=${evName(r.event_id)}  parsed=${JSON.stringify(r.parsed_name)}  file=${r.original_filename}`
    );
  }

  const perEvent = new Map<string, number>();
  for (const r of indexRows)
    perEvent.set(evName(r.event_id), (perEvent.get(evName(r.event_id)) ?? 0) + 1);
  console.log(`\nTile rows by event:`);
  for (const [ev, n] of [...perEvent.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${n}  ${ev}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
