import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { loadPeopleData, dismissedSetFrom } = await import("../../src/lib/faces/people-data");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const eventId = process.argv[2] ?? "4ac80a42-88ee-4042-ab56-1d7962e72032";
  const { data: ev } = await s.from("events").select("settings, name").eq("id", eventId).single();
  const data = await loadPeopleData(s as any, eventId, dismissedSetFrom(ev!.settings));
  console.log(`${ev!.name}`);
  console.log(`  mislabel suggestions: ${data.suggestions.mislabels.length}`);
  console.log(`  merge suggestions:    ${data.suggestions.merges.length}`);
  for (const m of data.suggestions.mislabels.slice(0, 15)) {
    console.log(`   - ${JSON.stringify(m).slice(0, 160)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
