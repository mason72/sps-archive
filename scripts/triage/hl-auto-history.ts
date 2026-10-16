/** Read-only: every machine-owned Highlights section, filled or waiting.  npx tsx scripts/triage/hl-auto-history.ts */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const sb = createServiceClient();
  const { data, error } = await sb
    .from("sections")
    .select("event_id, created_at, highlights_auto_count, highlights_auto_filled_at, events(name)")
    .not("highlights_auto_count", "is", null)
    .order("created_at");
  if (error) throw error;
  for (const s of data ?? []) {
    console.log(`${s.created_at.slice(0, 16)}  count=${s.highlights_auto_count}  filled=${s.highlights_auto_filled_at?.slice(0, 16) ?? "WAITING"}  ${(s.events as unknown as { name: string }).name}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
