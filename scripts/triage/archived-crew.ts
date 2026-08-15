import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("crew").select("display_name, city, is_regular").eq("archived", true);
  console.log(`archived crew: ${data?.length ?? 0}`);
  for (const c of (data ?? []).slice(0, 30)) console.log(`  ${c.display_name}  ${c.city ?? ""}${c.is_regular ? "  ★" : ""}`);
}
main();
