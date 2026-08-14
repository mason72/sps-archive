import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: crew } = await db.from("crew").select("display_name,city,region,kind,can_lead,travels,notes");
  const withCity = (crew??[]).filter((c:{city:string|null})=>c.city);
  console.log(`crew with a home city: ${withCity.length} / ${(crew??[]).length}`);
  console.log(`crew with can_lead:    ${(crew??[]).filter((c:{can_lead:string|null})=>c.can_lead).length}`);
  console.log(`crew with travels:     ${(crew??[]).filter((c:{travels:boolean|null})=>c.travels!=null).length}`);
  console.log(`crew with notes:       ${(crew??[]).filter((c:{notes:string|null})=>c.notes).length}`);
  console.log("\nsample:", JSON.stringify((crew??[]).slice(0,3)));
  const { data: orgs } = await db.from("organizations").select("id,name,domains,kind");
  console.log("\norganizations:");
  for (const o of orgs??[]) console.log(`  ${String(o.name).padEnd(22)} ${JSON.stringify(o.domains)}  ${o.kind}`);
  const { data: venues } = await db.from("venues").select("id,name,address,city");
  console.log("\nvenues:");
  for (const v of venues??[]) console.log(`  ${String(v.name).slice(0,36).padEnd(38)} city=${v.city ?? "—"}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
