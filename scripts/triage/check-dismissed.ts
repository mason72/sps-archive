import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const { dismissedSetFrom } = await import("../../src/lib/faces/people-data");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("events").select("settings").eq("id", "4ac80a42-88ee-4042-ab56-1d7962e72032").single();
  const d = dismissedSetFrom(data!.settings);
  console.log("dismissed suggestion keys:", d.size);
  for (const k of [...d].slice(0, 25)) console.log("  ", k);
})().catch(e => { console.error(e); process.exit(1); });
