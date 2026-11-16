/**
 * Run proposeHighlights on one event exactly as the auto-fill does and save the
 * picks, to compare picker versions (run it in a worktree at the old commit
 * for "before"). Reads only; the text-embedding call writes one usage row.
 *   npx tsx scripts/triage/highlights-propose-probe.ts <eventId> <count> <out.json>
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
async function main() {
  const [eventId, countA, out] = process.argv.slice(2);
  const { createClient } = await import("@supabase/supabase-js");
  const { proposeHighlights } = await import("../../src/lib/highlights/propose");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ev, error } = await s.from("events").select("user_id").eq("id", eventId).single();
  if (error) throw error;
  const t0 = Date.now();
  const r = await proposeHighlights(s, eventId, ev.user_id, { count: Number(countA), coverage: true, poolExtra: 0 });
  const ids = r.proposals.slice(0, Number(countA)).map((p) => p.frames[p.chosenIndex].id);
  console.log("seconds", ((Date.now() - t0) / 1000).toFixed(1), "picks", ids.length, "ranker", r.ranker, "ruledOut", JSON.stringify((r as { ruledOut?: unknown }).ruledOut ?? null), "notes", JSON.stringify((r as { notes?: unknown }).notes ?? null));
  fs.writeFileSync(out, JSON.stringify(ids));
}
main().catch((e) => { console.error(e); process.exit(1); });
