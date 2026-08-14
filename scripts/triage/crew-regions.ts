import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: crew } = await db.from("crew").select("city,region");
  const c = new Map<string,number>(), r = new Map<string,number>();
  for (const x of crew ?? []) {
    if (x.city) c.set(x.city, (c.get(x.city)??0)+1);
    if (x.region) r.set(x.region, (r.get(x.region)??0)+1);
  }
  console.log("crew.city values:");
  for (const [k,v] of [...c].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
  console.log("\ncrew.region values:");
  for (const [k,v] of [...r].sort((a,b)=>b[1]-a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
