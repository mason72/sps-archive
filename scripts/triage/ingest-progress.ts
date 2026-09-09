import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const since = new Date(Date.now() - 90*60*1000).toISOString();
  const { data, error } = await db.from("images").select("event_id, created_at").gt("created_at", since).order("created_at",{ascending:false}).limit(2000);
  if (error) throw error;
  const by = new Map<string, {n:number; last:string}>();
  for (const r of data ?? []) { const e = by.get(r.event_id) ?? {n:0,last:r.created_at}; e.n++; by.set(r.event_id, e); }
  if (!by.size) { console.log("no images created in the last 90 minutes"); return; }
  for (const [id, v] of by) {
    const { data: ev } = await db.from("events").select("name").eq("id", id).single();
    const ageMin = Math.round((Date.now() - new Date(v.last).getTime())/60000);
    console.log(`${String(v.n).padStart(5)} images  ${ev?.name ?? id}  (newest ${ageMin}m ago)`);
  }
}
main();
