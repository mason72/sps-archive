import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("crew").select("display_name, primary_email, aliases").ilike("display_name", "%darcy%");
  console.log(JSON.stringify(data, null, 1));
  const { count } = await s.from("crew").select("id", {count: "exact", head: true}).eq("display_name", "R .JD");
  console.log("R .JD rows remaining:", count);
})();
