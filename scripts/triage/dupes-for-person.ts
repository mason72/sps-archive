/**
 * Scratch: are a person's People-page photos inflated by duplicate uploads?
 * Membership uses personKeyForImage — the SAME predicate the /people tile
 * counts with — so the set here is exactly the set behind the number on screen.
 *
 * Pass A: same original_filename + same file_size  → near-certain duplicates.
 * Pass B: same file_size + width + height, different filename → renamed candidates.
 *
 *   npx tsx scripts/triage/dupes-for-person.ts "Steven Hughes"
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Usage: npx tsx scripts/triage/dupes-for-person.ts "First Last"');

  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { personKeyForImage, normalizeNameKey, NON_PERSON_GALLERIES } = await import(
    "../../src/lib/people/index-people"
  );

  const supabase = createServiceClient();
  const key = normalizeNameKey(name);

  const { data: events, error: evErr } = await supabase
    .from("events")
    .select("id, name, event_date, user_id");
  if (evErr) throw evErr;
  const eventById = new Map(
    (events ?? []).filter((e) => !NON_PERSON_GALLERIES.has(e.name)).map((e) => [e.id, e])
  );

  // Same candidate-then-verify shape as buildPersonDetail: ilike narrows,
  // personKeyForImage decides.
  const token = name
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ""))
    .sort((a, b) => b.length - a.length)[0];

  type Row = {
    id: string;
    event_id: string;
    parsed_name: string | null;
    original_filename: string;
    file_size: number;
    width: number | null;
    height: number | null;
    taken_at: string | null;
    processing_status: string;
    created_at: string;
  };
  const PAGE = 1000;
  const rows: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from("images")
      .select(
        "id, event_id, parsed_name, original_filename, file_size, width, height, taken_at, processing_status, created_at"
      )
      .in("event_id", [...eventById.keys()])
      .eq("media_type", "image")
      .eq("processing_status", "complete")
      .or(`parsed_name.ilike.%${token}%,original_filename.ilike.%${token}%`)
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  const mine = rows.filter(
    (r) => personKeyForImage(r.parsed_name, r.original_filename) === key
  );
  console.log(`\n${name}: ${mine.length} photos (membership = personKeyForImage)`);

  const evName = (id: string) => eventById.get(id)?.name ?? id;

  // Pass A — same filename + same bytes-on-disk size.
  const byNameSize = new Map<string, Row[]>();
  for (const r of mine) {
    const k = `${r.original_filename}|${r.file_size}`;
    byNameSize.set(k, [...(byNameSize.get(k) ?? []), r]);
  }
  const exact = [...byNameSize.values()].filter((g) => g.length > 1);
  const exactExtra = exact.reduce((n, g) => n + g.length - 1, 0);
  console.log(`\nPass A — same filename + size: ${exact.length} groups, ${exactExtra} extra copies`);
  for (const g of exact) {
    console.log(`  ${g[0].original_filename} (${g[0].file_size} bytes) x${g.length}`);
    for (const r of g) console.log(`    ${r.id}  ${evName(r.event_id)}  uploaded ${r.created_at}`);
  }

  // Pass B — same size + dimensions, different filename (renamed copies).
  const bySizeDims = new Map<string, Row[]>();
  for (const r of mine) {
    const k = `${r.file_size}|${r.width}|${r.height}`;
    bySizeDims.set(k, [...(bySizeDims.get(k) ?? []), r]);
  }
  const renamed = [...bySizeDims.values()].filter(
    (g) => g.length > 1 && new Set(g.map((r) => r.original_filename)).size > 1
  );
  console.log(`\nPass B — same size+dimensions, different name: ${renamed.length} groups`);
  for (const g of renamed) {
    console.log(`  ${g[0].file_size} bytes ${g[0].width}x${g[0].height} x${g.length}`);
    for (const r of g)
      console.log(`    ${r.id}  ${r.original_filename}  ${evName(r.event_id)}`);
  }

  // Orientation: where do his photos live?
  const perEvent = new Map<string, number>();
  for (const r of mine) perEvent.set(evName(r.event_id), (perEvent.get(evName(r.event_id)) ?? 0) + 1);
  console.log(`\nBy event:`);
  for (const [ev, n] of [...perEvent.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${n}  ${ev}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
