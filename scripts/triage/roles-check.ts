import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: links } = await db.from("event_crew").select("event_id,crew_id,roles,roles_source");
  const { data: crew } = await db.from("crew").select("id,display_name");
  const name = new Map((crew??[]).map((c:{id:string;display_name:string})=>[c.id,c.display_name]));
  const withRoles = (links??[]).filter((l:{roles:string[]})=>l.roles?.length);
  const inferred = (links??[]).filter((l:{roles_source:string})=>l.roles_source==="inferred");
  console.log(`links with roles : ${withRoles.length} / ${(links??[]).length}`);
  console.log(`marked inferred  : ${inferred.length}  (none should be 'manual' yet)`);
  const leadCount = new Map<string,number>();
  for (const l of links??[]) if ((l.roles??[]).includes("lead")) leadCount.set(l.crew_id,(leadCount.get(l.crew_id)??0)+1);
  console.log(`\nleads by person (all still provisional):`);
  for (const [id,n] of [...leadCount].sort((a,b)=>b[1]-a[1]))
    console.log(`  ${String(name.get(id)).padEnd(24)} ${n}`);
  // A lead needs somebody to lead.
  const byEvent = new Map<string,{roles:string[]}[]>();
  for (const l of links??[]) byEvent.set(l.event_id,[...(byEvent.get(l.event_id)??[]),l]);
  const solo = [...byEvent.values()].filter(rs=>rs.length===1 && rs[0].roles?.includes("lead"));
  console.log(`\nsolo jobs marked 'lead': ${solo.length} ${solo.length===0?"— PASS":"— should be 0"}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
