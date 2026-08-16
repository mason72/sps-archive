/**
 * One-off for the Chicago rows: a regular's "photographer" is settled fact
 * (Mason: all regulars are photographers), so confirm it for Joey and Jerrick
 * — they are why the strip said "3 assignments are still a guess" about his
 * own team.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const eventId = "7f174a0b-2c13-4981-9285-81fb05050ed6";
  const { data: rows } = await s
    .from("event_crew")
    .select("crew_id, roles, confirmed_roles, crew:crew_id(display_name, is_regular)")
    .eq("event_id", eventId);
  for (const r of rows ?? []) {
    const c = r.crew as any;
    if (!c?.is_regular) continue;
    const confirmed = [...new Set([...(r.confirmed_roles ?? []), ...(r.roles ?? [])])];
    const { error } = await s
      .from("event_crew")
      .update({ confirmed_roles: confirmed })
      .eq("event_id", eventId)
      .eq("crew_id", r.crew_id);
    console.log(`${c.display_name}: confirmed ${JSON.stringify(confirmed)} ${error ? error.message : "✓"}`);
  }
})();
