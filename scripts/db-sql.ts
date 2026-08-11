/**
 * Run SQL against the live Supabase project — the repo's only first-class path
 * for DDL and ad-hoc queries.
 *
 * Written 2026-08-11 because there wasn't one: the Supabase MCP transport was
 * failing, there is no `supabase` CLI on PATH, and .env.local carries no
 * Postgres URL — only PostgREST keys, which cannot run DDL. Migrations
 * 001–045 were applied by hand through tools that are not always available.
 *
 * Uses the Management API's query endpoint with a personal access token read
 * from the macOS keychain (`supabase-access-token`, same item as
 * scripts/gen-types.sh). The token reaches the process through the ENVIRONMENT,
 * never argv — argv is world-readable and captured by EDR (see
 * ~/.claude/rules/secrets-handling.md).
 *
 * ⚠️ .env.local points at PRODUCTION. There is no separate dev database.
 *
 *   npx tsx scripts/db-sql.ts --query "select count(*) from images"
 *   npx tsx scripts/db-sql.ts --file supabase/migrations/046_sps_pull.sql
 *   npx tsx scripts/db-sql.ts --file supabase/migrations/046_sps_pull.sql --apply
 *
 * --file without --apply prints the statement plan and exits, because a
 * migration is the one thing here that cannot be undone by re-running it.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID || "hfusdrtrizabzzcdhnyy";
const API = `https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`;

/** Guard rails prepended to every migration: never queue behind a long lock. */
const DDL_PREAMBLE = [
  // A DDL statement that cannot get its lock immediately must FAIL, not wait —
  // a queued ACCESS EXCLUSIVE lock blocks every read that arrives behind it,
  // which turns a millisecond migration into a gallery outage.
  "set lock_timeout = '5s';",
  "set statement_timeout = '120s';",
].join("\n");

function accessToken(): string {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  try {
    // The service name is not a secret; the value comes back on stdout and stays
    // in this process. Read once — repeated keychain reads are an EDR heuristic.
    return execFileSync(
      "security",
      ["find-generic-password", "-s", "supabase-access-token", "-w"],
      { encoding: "utf8" }
    ).trim();
  } catch {
    throw new Error(
      "No SUPABASE_ACCESS_TOKEN in the environment and no 'supabase-access-token' in the keychain."
    );
  }
}

async function run(sql: string, token: string): Promise<unknown> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      // Header built in-process: the token never appears in a command line.
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    // Surface the server's message — a Postgres error here is the whole point
    // of running this — but never echo the request headers.
    throw new Error(`Management API ${res.status}: ${text.slice(0, 2000)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Rough statement split for the plan printout. Comments and $$ bodies stay put. */
function summarize(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((s) => (s.length > 120 ? `${s.slice(0, 117)}…` : s));
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const queryIdx = argv.indexOf("--query");
  const fileIdx = argv.indexOf("--file");

  if (queryIdx === -1 && fileIdx === -1) {
    console.error(
      "usage: db-sql.ts --query <sql> | --file <path.sql> [--apply]"
    );
    process.exit(1);
  }

  const token = accessToken();

  if (queryIdx !== -1) {
    const sql = argv[queryIdx + 1];
    if (!sql) throw new Error("--query needs a SQL string");
    const out = await run(sql, token);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const path = argv[fileIdx + 1];
  if (!path) throw new Error("--file needs a path");
  const sql = fs.readFileSync(path, "utf8");
  const statements = summarize(sql);

  console.log(`\n${path} — ${statements.length} statement(s) against PRODUCTION\n`);
  statements.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to execute.\n");
    return;
  }

  const out = await run(`${DDL_PREAMBLE}\n${sql}`, token);
  console.log("\nApplied.", JSON.stringify(out));

  // Keep the migration ledger honest — a file applied but unrecorded is a file
  // the next person applies again. The ledger versions are UTC timestamps, NOT
  // this repo's 0NN file numbering (every existing row was written by a tool
  // that stamped the clock), so match that or the row sorts to the beginning of
  // time and reads as the oldest migration in the project.
  const name = (path.split("/").pop() ?? path)
    .replace(/\.sql$/, "")
    .replace(/^\d+_/, "");
  const version = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  await run(
    `insert into supabase_migrations.schema_migrations (version, name)
     values ('${version}', '${name.replace(/'/g, "''")}')
     on conflict (version) do nothing;`,
    token
  );
  console.log(
    `Recorded in supabase_migrations.schema_migrations (${version}, ${name}).`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
