import fs from "node:fs";
const env = "/Users/masonfoster/Projects/SPS/spsv2/apps/admin/.env.local";
for (const line of fs.readFileSync(env, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("events").select("name, status, image_count, completed_at").order("created_at", {ascending: false}).limit(8);
  for (const e of data ?? []) console.log(JSON.stringify(e));
  // Live upload activity — the ship-discipline gate before any SPS deploy.
  const since = new Date(Date.now() - 60*60*1000).toISOString();
  const { count } = await s.from("images").select("id", {count: "exact", head: true}).gt("created_at", since);
  console.log("images uploaded to SPS in the last hour:", count);
})();
