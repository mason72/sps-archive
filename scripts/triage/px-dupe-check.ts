/**
 * Count DUPLICATE rows in an event, by original_filename.
 *
 * Written 2026-08-21 after the Pixieset ingest's "already in" pre-read was found
 * to be an UNPAGED PostgREST select: it silently caps at 1,000 rows, so every
 * image past the first thousand was invisible to the dedupe check and got
 * re-imported on every retry pass.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const id = process.argv[2];
  const seen = new Map<string, number>();
  let total = 0;
  // Page explicitly and ORDER BY a unique column — an unordered .range() is the
  // other half of this same family of bug (lesson 88).
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("images").select("id,original_filename").eq("event_id", id)
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const r of data) {
      total++;
      const k = String(r.original_filename ?? "").toLowerCase();
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    if (data.length < 1000) break;
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  const extra = dupes.reduce((a, [, n]) => a + (n - 1), 0);
  console.log(`total rows      : ${total}`);
  console.log(`unique filenames: ${seen.size}`);
  console.log(`filenames dup'd : ${dupes.length}`);
  console.log(`EXTRA rows      : ${extra}`);
  console.log(`worst offenders : ${dupes.sort((a,b)=>b[1]-a[1]).slice(0,5).map(([f,n])=>`${f}×${n}`).join(", ") || "none"}`);
}
main().catch((e) => { console.error(String(e).slice(0, 300)); process.exit(1); });
