/**
 * Strip the "zz"/"zzz" sort-to-the-bottom prefixes from crew names.
 * Mason, 2026-08-15: "you can remove the zz. I added that so they'd go to the
 * end of a list" — the archive flag does that job now. Only a LEADING zz/zzz
 * followed by an uppercase letter is touched, so a real name starting with Z
 * can never be clipped. display_name, full_name and aliases all checked.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const strip = (s: string) => s.replace(/^z{2,3}(?=[A-Z])/, "");
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data } = await s.from("crew").select("id, display_name, full_name, aliases");
  for (const c of data ?? []) {
    const next = {
      display_name: strip(c.display_name),
      full_name: c.full_name ? strip(c.full_name) : c.full_name,
      aliases: (c.aliases ?? []).map(strip),
    };
    const changed =
      next.display_name !== c.display_name ||
      next.full_name !== c.full_name ||
      JSON.stringify(next.aliases) !== JSON.stringify(c.aliases ?? []);
    if (!changed) continue;
    const { error } = await s.from("crew").update(next).eq("id", c.id);
    console.log(`"${c.display_name}" → "${next.display_name}" ${error ? `ERROR ${error.message}` : "✓"}`);
  }
}
main();
