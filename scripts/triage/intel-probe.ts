import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }
async function main(){
  const { buildIntelIndex } = await import("../../src/lib/event-intel/index-intel");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;
  const { data: u } = await db.from("events").select("user_id").limit(1).single();
  const idx = await buildIntelIndex(db, u.user_id);

  console.log(`coverage      ${idx.totalEventCount - idx.uncoveredEventCount}/${idx.totalEventCount} events have intel`);
  console.log(`axes          ${idx.people.length} people · ${idx.venues.length} venues · ${idx.cities.length} cities · ${idx.orgs.length} clients\n`);

  console.log("top people");
  for (const p of idx.people.slice(0,6))
    console.log(`  ${p.name.padEnd(20)} ${String(p.eventCount).padStart(2)} gigs · ${p.cities.length} cities · ${p.coCrewIds.length} co-crew · roles ${Object.keys(p.roleCounts).length}`);

  console.log("\ntop venues");
  for (const v of idx.venues.slice(0,6))
    console.log(`  ${v.name.slice(0,34).padEnd(36)} ${String(v.eventCount).padStart(2)} gigs · ${v.crewIds.length} crew · ${v.city ?? "—"}`);

  console.log("\ntop cities");
  for (const c of idx.cities.slice(0,8))
    console.log(`  ${c.name.padEnd(18)} ${String(c.eventCount).padStart(2)} gigs · ${c.localCrewIds.length} local crew · ${c.venueIds.length} venues`);

  console.log("\nclients");
  for (const o of idx.orgs.slice(0,8))
    console.log(`  ${o.name.slice(0,28).padEnd(30)} ${String(o.eventCount).padStart(2)} gigs · ${o.crewIds.length} crew · ${o.cities.join(", ") || "—"}`);

  // The pivot must agree with itself: if Joey worked a venue, that venue must
  // list Joey. A cross-section that disagrees is worse than no cross-section.
  let bad = 0;
  const venueById = new Map(idx.venues.map(v=>[v.id,v]));
  for (const p of idx.people)
    for (const vid of p.venueIds)
      if (!venueById.get(vid)?.crewIds.includes(p.id)) { bad++; console.log(`  ✗ ${p.name} lists venue ${vid} but not vice versa`); }
  console.log(`\nreciprocity check: ${bad === 0 ? "PASS — every person↔venue pair agrees" : `${bad} MISMATCHES`}`);
}
main().catch(e=>{console.error(e.message);process.exit(1)});
