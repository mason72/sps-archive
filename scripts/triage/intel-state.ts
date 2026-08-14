import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  for (const t of ["venues","crew","organizations","crew_roles","event_intel","event_crew","event_orgs","venue_notes"]) {
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t.padEnd(16)} ${error ? "ERR " + error.message : count}`);
  }
  const { data: roles } = await db.from("event_crew").select("roles");
  const withRoles = (roles ?? []).filter((r: {roles: string[]}) => r.roles?.length).length;
  console.log(`\n  event_crew with roles: ${withRoles} / ${(roles ?? []).length}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
