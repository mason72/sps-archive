import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }

/** Rename organisations from how Mason writes them, not from their domain. */
async function main(){
  const apply = process.argv.includes("--apply");
  const { orgDisplayName } = await import("../../src/lib/event-intel/org-name");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: orgs, error } = await db.from("organizations").select("id,name,domains");
  if (error) throw new Error(error.message);
  const { data: links } = await db.from("event_orgs").select("org_id,event_id");
  const { data: events } = await db.from("events").select("id,name");
  const nameById = new Map((events ?? []).map((e: {id:string;name:string}) => [e.id, e.name]));

  for (const o of orgs ?? []) {
    const titles = (links ?? [])
      .filter((l: {org_id:string}) => l.org_id === o.id)
      .map((l: {event_id:string}) => nameById.get(l.event_id))
      .filter((x: string | undefined): x is string => !!x);
    const domain = (o.domains ?? [])[0] ?? o.name;
    const better = orgDisplayName(domain, titles);
    if (!better || better === o.name) { console.log(`  ·  ${o.name}`); continue; }
    console.log(`  →  ${o.name.padEnd(20)} → ${better}${titles.length ? `   (from "${titles[0]}")` : "   (from domain)"}`);
    if (apply) {
      const { error: err } = await db.from("organizations")
        .update({ name: better, updated_at: new Date().toISOString() }).eq("id", o.id);
      if (err) console.error(`     ✗ ${err.message}`);
    }
  }
  if (!apply) console.log("\ndry run — re-run with --apply");
}
main().catch(e=>{console.error(e.message);process.exit(1)});
