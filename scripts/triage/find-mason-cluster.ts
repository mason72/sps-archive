import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s
    .from("persons")
    .select("id, name, face_count, event_id, events!inner(name, user_id)")
    .in("name", ["Mason Foster", "Nicole Allen"]);
  for (const p of data ?? []) {
    console.log(`${p.name}  faces=${p.face_count}  person=${p.id}  event=${p.event_id}  "${(p as any).events.name}"`);
  }
}
main();
