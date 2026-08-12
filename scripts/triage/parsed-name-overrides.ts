/**
 * Rows whose parsed_name no longer matches what the filename parses to — i.e.
 * a People-view "fix-label" override was applied. After the byte repair these
 * overrides are wrong: they renamed a correctly-named row to match a picture
 * that was itself the corruption.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { parseFilename } = await import("../../src/lib/upload/parse-filename");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const eventId = process.argv[2] ?? "4ac80a42-88ee-4042-ab56-1d7962e72032";
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from("images")
      .select("id, original_filename, parsed_name, updated_at")
      .eq("event_id", eventId).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const drift = rows.filter(r => {
    const fromFile = parseFilename(r.original_filename).name;
    return (r.parsed_name ?? null) !== (fromFile ?? null);
  });
  console.log(`rows: ${rows.length}`);
  console.log(`parsed_name overridden: ${drift.length}\n`);
  for (const r of drift) {
    console.log(`${r.original_filename}`);
    console.log(`   parsed_name now: "${r.parsed_name}"   (filename says "${parseFilename(r.original_filename).name}")`);
  }
})().catch(e => { console.error(e); process.exit(1); });
