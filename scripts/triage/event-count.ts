import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ev } = await db.from("events").select("id,name").ilike("name","%Postman%").limit(1).single();
  if (!ev) { console.log("no Postman event"); return; }
  const { count } = await db.from("images").select("id",{count:"exact",head:true}).eq("event_id", ev.id);
  console.log(`${new Date().toISOString().slice(11,19)}  ${ev.name}: ${count} images`);
}
main();
