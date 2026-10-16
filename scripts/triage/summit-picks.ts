/** Read-only: would the auto-fill pick a section-less (cover-only) row?
 *   npx tsx scripts/triage/summit-picks.ts <eventId> [count] */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const id = process.argv[2];
  const count = Number(process.argv[3] ?? 75);
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { proposeHighlights } = await import("../../src/lib/highlights/propose");
  const sb = createServiceClient();
  const { data: ev, error } = await sb.from("events").select("user_id").eq("id", id).single();
  if (error) throw error;
  const r = await proposeHighlights(sb, id, ev.user_id, { count, coverage: true, poolExtra: 0 });
  const picks = r.proposals.slice(0, count).map((p) => p.frames[p.chosenIndex] ?? p.frames[0]);
  const allFrames = r.proposals.flatMap((p) => p.frames);
  const ids = allFrames.map((f) => f.id);
  const linked = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from("section_images").select("image_id").in("image_id", ids.slice(i, i + 200));
    for (const row of data ?? []) linked.add(row.image_id as string);
  }
  const orphanFrames = allFrames.filter((f) => !linked.has(f.id));
  const orphanPicks = picks.filter((f) => f && !linked.has(f.id));
  console.log(`proposals=${r.proposals.length} frames=${allFrames.length} section-less frames in proposals=${orphanFrames.length} section-less PICKS=${orphanPicks.length}`);
  for (const f of orphanFrames) console.log("  ", f.id, (f as { original_filename?: string }).original_filename);
}
main().catch((e) => { console.error(e); process.exit(1); });
