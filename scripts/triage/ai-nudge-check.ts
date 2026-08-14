import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data, error } = await db.rpc("events_needing_ai_index", { max_events: 200 });
  if (error) { console.error("✗ rpc error:", error.message); process.exit(1); }
  console.log(`rpc ok — ${(data ?? []).length} events pending AI index`);
  for (const r of (data ?? []).slice(0, 10))
    console.log(`  ${r.event_id}  pending=${r.pending}  oldest=${r.oldest}`);

  // FIFO is the whole point of the change — assert it rather than assume it.
  const ts = (data ?? []).map((r: {oldest:string}) => Date.parse(r.oldest));
  const sorted = ts.every((v: number, i: number) => i === 0 || ts[i-1] <= v);
  console.log(`\nFIFO order (oldest first): ${sorted ? "PASS" : "FAIL"}`);

  // The clamp must hold whatever is passed.
  const { data: big } = await db.rpc("events_needing_ai_index", { max_events: 99999 });
  const { data: zero } = await db.rpc("events_needing_ai_index", { max_events: 0 });
  console.log(`clamp: 99999 → ${(big ?? []).length} rows, 0 → ${(zero ?? []).length} rows (both must not throw)`);

  // The old approach, for comparison: no ORDER BY, 5000 rows, first 25 distinct.
  const { data: old } = await db.from("images").select("event_id")
    .is("ai_indexed_at", null).eq("thumbnail_generated", true).eq("media_type","image").limit(5000);
  const oldIds = [...new Set((old ?? []).map((r: {event_id:string}) => r.event_id))].slice(0,25);
  console.log(`\nold path would have nudged ${oldIds.length} events from ${(old ?? []).length} sampled rows`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
