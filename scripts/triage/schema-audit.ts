/**
 * Does supabase/migrations/ describe the database that is actually running?
 *
 * Written 2026-08-12 after `event_readiness` was found serving every dashboard
 * load while existing in no migration file anywhere in the repo. If the folder
 * is the recipe for rebuilding production, anything live but unnamed in it is a
 * step that would silently be skipped.
 *
 * Method: enumerate live objects the app owns, then look for a statement that
 * CREATES each one in the migration SQL.
 *
 * The first version of this searched for the bare name anywhere in the corpus
 * and reported `subscriptions` as covered — on the strength of a `drop index if
 * exists` line in 033 that merely mentions it. The table is created nowhere in
 * the repo. A check loose enough to be satisfied by any mention will always
 * agree that everything is fine, so the patterns below require a creating
 * statement. Extension-owned objects (pgvector's hundreds of operators,
 * pgcrypto, etc.) are excluded: they come from `create extension`, not our DDL.
 *
 * Read-only. Prints a report; writes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const MIGRATIONS_DIR = "supabase/migrations";

function migrationCorpus(): { text: string; files: string[] } {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const text = files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    .toLowerCase();
  return { text, files };
}

function sql(query: string): Array<Record<string, unknown>> {
  // The runner reads its token from the environment/keychain — never argv.
  const out = execFileSync(
    "npx",
    ["tsx", "scripts/db-sql.ts", "--query", query],
    { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 }
  );
  const start = out.indexOf("[");
  const end = out.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  return JSON.parse(out.slice(start, end + 1));
}

function main() {
  const { text, files } = migrationCorpus();
  console.log(`${files.length} migration file(s) in ${MIGRATIONS_DIR}\n`);

  /** Does the corpus contain a statement that CREATES this object? */
  const creates = (label: string, name: string): boolean => {
    const n = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const q = `(public\\.)?"?${n}"?`;
    const patterns: Record<string, RegExp> = {
      TABLE: new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?${q}`),
      INDEX: new RegExp(
        `create\\s+(unique\\s+)?index\\s+(concurrently\\s+)?(if\\s+not\\s+exists\\s+)?${q}`
      ),
      FUNCTION: new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+${q}`),
      POLICY: new RegExp(`create\\s+policy\\s+${q}`),
      TRIGGER: new RegExp(`create\\s+(or\\s+replace\\s+)?trigger\\s+${q}`),
    };
    return patterns[label].test(text);
  };

  const checks: Array<{ label: string; query: string; nameKey: string }> = [
    {
      label: "TABLE",
      nameKey: "name",
      query: `select tablename as name from pg_tables where schemaname='public' order by tablename`,
    },
    {
      label: "INDEX",
      nameKey: "name",
      query: `select indexname as name from pg_indexes where schemaname='public'
              and indexname not in (select conname from pg_constraint)
              order by indexname`,
    },
    {
      label: "FUNCTION",
      nameKey: "name",
      // Exclude anything an extension owns — pgvector alone installs hundreds.
      query: `select p.proname as name from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname='public'
                and not exists (
                  select 1 from pg_depend d
                  where d.objid = p.oid and d.deptype = 'e'
                )
              order by p.proname`,
    },
    {
      label: "POLICY",
      nameKey: "name",
      query: `select policyname as name from pg_policies where schemaname='public' order by policyname`,
    },
    {
      label: "TRIGGER",
      nameKey: "name",
      // `auth` as well as `public`: the signup triggers live on auth.users, and
      // scoping this to public hid them completely — including a DUPLICATE pair
      // (on_auth_user_created_subscription and on_auth_user_subscription) that
      // both fire handle_new_user_subscription on every signup.
      query: `select t.tgname as name from pg_trigger t
              join pg_class c on c.oid = t.tgrelid
              join pg_namespace n on n.oid = c.relnamespace
              where n.nspname in ('public','auth') and not t.tgisinternal
              order by t.tgname`,
    },
  ];

  let missingTotal = 0;
  for (const check of checks) {
    const rows = sql(check.query);
    const missing = rows
      .map((r) => String(r[check.nameKey]))
      .filter((name) => !creates(check.label, name));
    console.log(
      `${check.label.padEnd(9)} ${String(rows.length).padStart(4)} live, ${String(missing.length).padStart(3)} with NO mention in any migration`
    );
    for (const name of missing) console.log(`             · ${name}`);
    missingTotal += missing.length;
  }

  // Object names are not the schema. Several unversioned ledger entries are
  // ALTERs (015_processing_state, usage_metering_fixes), and a column added by
  // one of those leaves every table/index/function check perfectly happy while
  // the rebuilt table is the wrong SHAPE. A column whose name appears NOWHERE
  // in the corpus cannot have been created by it.
  const columns = sql(
    `select table_name, column_name from information_schema.columns
     where table_schema='public'
       and table_name in (select tablename from pg_tables where schemaname='public')
     order by table_name, ordinal_position`
  );
  const unversionedColumns = columns.filter(
    (c) => !new RegExp(`\\b${String(c.column_name).toLowerCase()}\\b`).test(text)
  );
  console.log(
    `COLUMN    ${String(columns.length).padStart(4)} live, ${String(unversionedColumns.length).padStart(3)} whose name appears in NO migration`
  );
  for (const c of unversionedColumns)
    console.log(`             · ${c.table_name}.${c.column_name}`);
  missingTotal += unversionedColumns.length;

  // The ledger's view of the world vs the folder's.
  const recorded = sql(
    `select version, name from supabase_migrations.schema_migrations order by version`
  );
  const fileVersions = new Set(files.map((f) => f.split("_")[0]));
  const orphanLedger = recorded.filter((r) => {
    const v = String(r.version);
    // Repo files are numbered 001…047; the ledger uses timestamps. Match on the
    // NAME instead, which the runner derives from the filename.
    return !files.some((f) => f.toLowerCase().includes(String(r.name).toLowerCase()));
  });
  console.log(
    `\nLEDGER    ${recorded.length} applied migration(s) recorded in supabase_migrations.schema_migrations`
  );
  for (const r of orphanLedger)
    console.log(`             · ${r.version} ${r.name} — recorded as applied, no matching file`);

  console.log(
    `\n${missingTotal} live object(s) unnamed in any migration; ${orphanLedger.length} ledger entr(ies) with no file.`
  );
  void fileVersions;
}

main();
