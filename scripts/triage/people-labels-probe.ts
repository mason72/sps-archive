/**
 * Scratch: build the real People index and check that event labels are gone
 * and real people are not. Read-only.
 *
 *   npx tsx scripts/triage/people-labels-probe.ts
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { buildPeopleIndex, normalizeNameKey } = await import("../../src/lib/people/index-people");
  const supabase = createServiceClient();
  const { data: ev } = await supabase.from("events").select("user_id").ilike("name", "%Core SJC%").limit(1).single();
  const t = Date.now();
  const index = await buildPeopleIndex(supabase, ev!.user_id);
  const keys = new Map(index.map((p) => [p.key, p]));
  const show = (n: string) => {
    const p = keys.get(normalizeNameKey(n));
    return p ? `PRESENT (${p.imageCount} photos, ${p.eventCount} events)` : "absent";
  };
  console.log(`people: ${index.length} · built in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  for (const n of ["Google Booth", "Bay, Alarm", "Harrier, Wedding", "Haley Neil", "Mason, Tang", "Kinder", "Dolores"]) console.log("label  ", n.padEnd(18), show(n));
  for (const n of ["Steven Hughes", "Nachi", "Jenna Loeser", "Justin Heller", "Brittany Reed"]) console.log("person ", n.padEnd(18), show(n));
})().catch((e) => { console.error(e); process.exit(1); });
