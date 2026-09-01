// What statement_timeout does PostgREST ACTUALLY apply, per role?
//
// WHY THIS EXISTS. `ALTER ROLE … SET statement_timeout` binds at LOGIN, and
// PostgREST logs in as `authenticator` and then switches role per request — so
// a role setting is not self-evidently in force. Reading pg_db_role_setting
// only proves the row exists, never that requests get it. Ask through the real
// client. (Verified 2026-09-01: PostgREST does apply them — migration 074 set
// service_role to 15s and this printed 15s, while anon still printed 3s.)
//
// Needs a helper function, which is NOT left on production. Create it, run this,
// then drop it:
//
//   npx tsx scripts/db-sql.ts --apply --query "create or replace function \
//     public.__timeout_probe() returns text language sql stable as \
//     \$\$ select current_setting('statement_timeout') \$\$; \
//     grant execute on function public.__timeout_probe() to anon, service_role;"
//
//   npx tsx scripts/triage/timeout-probe.ts
//
//   npx tsx scripts/db-sql.ts --apply --query "drop function public.__timeout_probe();"
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  for (const [label, key] of [
    ["service_role (jobs + API routes)", process.env.SUPABASE_SERVICE_ROLE_KEY!],
    ["anon        (guest galleries)   ", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!],
  ] as const) {
    const { data, error } = await createClient(url, key).rpc("__timeout_probe");
    console.log(`  ${label}  ${error ? `ERROR: ${error.message}` : data}`);
  }
}
main();
