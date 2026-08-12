/**
 * End-to-end check of the Highlights ranker against a live event (read-only).
 *   npx tsx scripts/verify-highlights-propose.ts <eventId>
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const eventId = process.argv[2] ?? "e8459f76-1212-461e-9078-cdc6e945e68c";
  const { createClient } = await import("@supabase/supabase-js");
  const { buildHighlightsPlan, proposeHighlights } = await import("../src/lib/highlights/propose");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as never;
  const sup = s as unknown as Parameters<typeof buildHighlightsPlan>[0];

  const { data: ev, error } = await (s as any).from("events").select("user_id, name").eq("id", eventId).single();
  if (error) throw error;
  console.log("event:", ev.name);

  const t0 = Date.now();
  const plan = await buildHighlightsPlan(sup, eventId, ev.user_id);
  console.log(`\nPLAN (${Date.now() - t0}ms):`, plan);

  const t1 = Date.now();
  const res = await proposeHighlights(sup, eventId, ev.user_id, { count: 40, coverage: true });
  console.log(`\nPROPOSE (${Date.now() - t1}ms): ranker=${res.ranker} trainedOnPicks=${res.trainedOnPicks} pool=${res.proposals.length}/${res.totalMoments}`);

  const top = res.proposals.slice(0, 40);
  const multi = top.filter((p) => p.frames.length > 1).length;
  console.log(`top40: ${multi} moments have sibling frames`);
  const times = top.map((p) => p.frames[0].takenAt).filter(Boolean).sort();
  console.log("time spread of top40:", times[0], "→", times[times.length - 1]);

  // Overlap with Claude's published blind-test picks.
  const mine: { rep_id: string; taken_at?: string }[] = JSON.parse(fs.readFileSync("tasks/highlights-blind-test-picks.json", "utf8"));
  const mineIds = new Set(mine.map((m) => m.rep_id));
  const chosenIds = new Set(top.map((p) => p.frames[p.chosenIndex].id));
  let overlap = 0;
  for (const id of chosenIds) if (mineIds.has(id)) overlap++;
  console.log(`\noverlap with Claude's 40 blind picks: ${overlap}/40 exact frames`);
  const mineMoments = new Set(mine.map((m) => m.taken_at ?? ""));
  const overlapMoment = top.filter((p) => mineMoments.has(p.momentId.replace(/^t:/, ""))).length;
  console.log(`overlap at MOMENT level: ${overlapMoment}/40`);
}
main().catch((e) => { console.error(e); process.exit(1); });
