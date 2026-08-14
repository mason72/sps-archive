import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const since = new Date(Date.now() - 6*3600*1000).toISOString();
  const { count: recent } = await db.from("images").select("*", {count:"exact",head:true}).gte("created_at", since);
  const { count: pending } = await db.from("images").select("*", {count:"exact",head:true}).eq("processing_status","pending");
  const today = new Date().toISOString().slice(0,10);
  const { data: todayEvents } = await db.from("events").select("name,event_date").eq("event_date", today);
  console.log(`images uploaded in last 6h : ${recent}`);
  console.log(`images pending             : ${pending}`);
  console.log(`events dated today         : ${(todayEvents??[]).length} ${(todayEvents??[]).map((e:{name:string})=>e.name).join(", ")}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
