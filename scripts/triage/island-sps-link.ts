import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("events")
    .select("id, name, user_id, settings")
    .eq("id", "4ac80a42-88ee-4042-ab56-1d7962e72032").single();
  const st = (data as any).settings ?? {};
  console.log("event:", data!.name);
  console.log("settings.spsEventId:", st.spsEventId ?? "(none)");
  const { data: conns } = await s.from("sps_connections").select("user_id, created_at");
  console.log("sps_connections rows:", (conns ?? []).length,
    "| owner has one:", (conns ?? []).some((c: any) => c.user_id === data!.user_id));
})().catch(e => { console.error(e); process.exit(1); });
