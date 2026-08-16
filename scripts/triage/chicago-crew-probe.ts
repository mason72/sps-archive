import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: ev } = await s.from("events").select("id, name, settings").ilike("name", "%Chicago%");
  for (const e of ev ?? []) {
    console.log(`EVENT: ${e.name}  ${e.id}`);
    const { data: intel } = await s.from("event_intel").select("confirmed_at, source, calendar_event_ids").eq("event_id", e.id).maybeSingle();
    console.log("  intel:", JSON.stringify(intel));
    const { data: crew } = await s
      .from("event_crew")
      .select("roles, confirmed_roles, would_rebook, roles_source, note, crew:crew_id(display_name)")
      .eq("event_id", e.id);
    for (const c of crew ?? []) {
      console.log(`  ${(c.crew as any)?.display_name}: roles=${JSON.stringify(c.roles)} confirmed=${JSON.stringify(c.confirmed_roles)} rebook=${c.would_rebook} source=${c.roles_source}`);
    }
  }
  const { data: errs } = await s
    .from("system_errors")
    .select("context, message, created_at")
    .gt("created_at", "2026-08-15T20:00:00Z")
    .ilike("context", "%intel%")
    .order("created_at", { ascending: false })
    .limit(5);
  console.log("recent intel errors:", JSON.stringify(errs));
})();

(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("crew").select("display_name, rehire, is_regular").in("display_name", ["Kelly Cunningham", "Joey Nagoshiner", "Jerrick Richard Mitra"]);
  console.log("crew.rehire baselines:", JSON.stringify(data));
})();
