/**
 * Read-only: why is an event "processing" and its Highlights not filled?
 *   npx tsx scripts/triage/summit-state.ts "<name fragment>"
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const frag = process.argv[2] || "Community Summit";
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { AI_INDEX_MAX_ATTEMPTS } = await import("../../src/lib/ai-index/failures");
  const sb = createServiceClient();
  const { data: events, error } = await sb
    .from("events")
    .select("id, name, created_at, settings")
    .ilike("name", `%${frag}%`);
  if (error) throw error;
  for (const e of events ?? []) {
    console.log(`\n== ${e.name}  ${e.id}  created ${e.created_at}`);
    const { data: r, error: rErr } = await sb.rpc("event_readiness", {
      p_event_ids: [e.id],
      p_max_attempts: AI_INDEX_MAX_ATTEMPTS,
    });
    if (rErr) throw rErr;
    console.log("readiness:", JSON.stringify(r?.[0]));
    const { data: secs } = await sb
      .from("sections")
      .select("id, name, highlights_auto_count, highlights_auto_filled_at, locked, sort_order")
      .eq("event_id", e.id)
      .order("sort_order");
    for (const s of secs ?? []) {
      const { count } = await sb
        .from("section_images").select("image_id", { count: "exact", head: true }).eq("section_id", s.id);
      console.log(`  section ${s.name} n=${count} auto=${s.highlights_auto_count} filled=${s.highlights_auto_filled_at} locked=${s.locked}`);
    }
    const { data: stuck } = await sb
      .from("images")
      .select("id, original_filename, media_type, processing_status, thumbnail_generated, ai_indexed_at, ai_index_attempts, ai_index_failed_at, created_at")
      .eq("event_id", e.id)
      .is("ai_indexed_at", null)
      .order("created_at")
      .limit(50);
    console.log(`  unindexed rows (first 50): ${stuck?.length}`);
    for (const s of stuck ?? []) console.log("   ", JSON.stringify(s));
    const { data: newest } = await sb
      .from("images").select("ai_indexed_at").eq("event_id", e.id)
      .not("ai_indexed_at", "is", null).order("ai_indexed_at", { ascending: false }).limit(1);
    console.log("  newest ai_indexed_at:", newest?.[0]?.ai_indexed_at);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
