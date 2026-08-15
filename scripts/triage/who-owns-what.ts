/**
 * Which account owns the crew, venues, orgs and events?
 *
 * Decides whether Event Intel belongs to ONE user id or to the two
 * twodudesphoto logins. Getting this wrong fails closed — Intel would simply
 * vanish for whichever account actually uses it — but that is still a visible
 * outage, so measure rather than assume.
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: users } = await s.auth.admin.listUsers({ perPage: 200 });
  const email = new Map((users?.users ?? []).map((u) => [u.id, u.email ?? "?"]));

  for (const table of ["crew", "venues", "organizations", "events", "event_intel", "event_crew", "sps_connections"]) {
    const { data, error } = await s.from(table).select("user_id").limit(5000);
    if (error) {
      console.log(`${table.padEnd(18)} ERROR ${error.message}`);
      continue;
    }
    const by = new Map<string, number>();
    for (const r of data ?? []) {
      const k = (r as { user_id: string | null }).user_id ?? "(null)";
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    const parts = [...by.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${email.get(id) ?? id}=${n}`);
    console.log(`${table.padEnd(18)} ${parts.join("  ")}`);
  }
}

main();
