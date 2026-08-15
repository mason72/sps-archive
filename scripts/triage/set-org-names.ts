/**
 * The three client names Mason settled 2026-08-15: Episode.1, Type A Events,
 * WACA. Names are labels, domains are identity — update name only, keyed by
 * domain, and SHOW the before/after.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const NAMES: Record<string, string> = {
  "episode1agency.com": "Episode.1",
  "typeaevents.com": "Type A Events",
  "wallandceiling.org": "WACA",
};
async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  for (const [domain, name] of Object.entries(NAMES)) {
    const { data: found } = await s
      .from("organizations")
      .select("id, name, user_id")
      .contains("domains", [domain]);
    if (!found?.length) {
      console.log(`${domain}: NO ORG ROW — nothing to rename (it will be named on first gig link)`);
      continue;
    }
    for (const org of found) {
      const { error } = await s.from("organizations").update({ name }).eq("id", org.id);
      console.log(`${domain}: "${org.name}" → "${name}" ${error ? `ERROR ${error.message}` : "✓"}`);
    }
  }
}
main();
