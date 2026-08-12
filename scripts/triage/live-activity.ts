import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const since = new Date(Date.now() - 90 * 60 * 1000).toISOString();
  const { data } = await s.from("images").select("event_id, created_at, processing_status").gte("created_at", since);
  const by = new Map<string, number>();
  for (const r of data ?? []) by.set(r.event_id, (by.get(r.event_id) ?? 0) + 1);
  console.log("rows created in last 90 min:", data?.length ?? 0);
  const { data: ev } = await s.from("events").select("id,name").in("id", [...by.keys()]);
  for (const [id, n] of by) console.log(" ", (ev ?? []).find(e => e.id === id)?.name ?? id, "→", n);
  const { data: pend } = await s.from("images").select("id").eq("processing_status", "pending").gte("created_at", since);
  console.log("pending (in-flight) rows:", pend?.length ?? 0);
})();
