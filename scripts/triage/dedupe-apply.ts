/**
 * Execute the dedupe plan in tasks/dedupe-manifest.json.
 *
 * EXCLUDES the TDP Website gallery, always and by name. Membership in that
 * gallery IS publication, and the same photo published to several scenes exists
 * as several ROWS — verified: one pair sat in `slot/hero/headshot-booth` and
 * `bts/headshot-booth`. Identical name+size there does not mean redundant, it
 * means published twice on purpose, and removing a row strips a photo off a
 * live page. All 71 of its candidates were flagged CHANGES PAGE by
 * scripts/triage/tdp-dedupe-impact.ts. (Mason, 2026-08-12: confirm it won't
 * break the website — it would, so it is excluded rather than reviewed.)
 *
 * DELETES DATABASE ROWS ONLY — never the R2 objects. That is what keeps this
 * reversible: every removed row's bytes stay in the bucket under its own
 * r2_key, so a row can be recreated from the manifest. Deleting bytes would
 * make it one-way. Orphaned objects are a storage cost, recorded as follow-up.
 *
 *   npx tsx scripts/triage/dedupe-apply.ts            # dry run
 *   npx tsx scripts/triage/dedupe-apply.ts --apply
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const EXCLUDE = new Set(["TDP Website"]);
const BACKUP = "tasks/dedupe-removed-rows.json";

async function main() {
  const apply = process.argv.includes("--apply");
  const { createClient } = await import("@supabase/supabase-js");
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const manifest = JSON.parse(fs.readFileSync("tasks/dedupe-manifest.json", "utf8")) as Array<{
    name: string;
    eventId: string;
    deletions: Array<{ keep: string; remove: string; key: string }>;
  }>;

  const targets = manifest.filter((e) => !EXCLUDE.has(e.name) && e.deletions.length > 0);
  const skipped = manifest.filter((e) => EXCLUDE.has(e.name));
  for (const e of skipped) {
    console.log(`EXCLUDED  ${e.name} — ${e.deletions.length} candidate(s) left in place (publication model)`);
  }

  const ids = targets.flatMap((e) => e.deletions.map((d) => d.remove));
  console.log(`\n${targets.length} galleries, ${ids.length} rows to remove.`);

  // Full row snapshot BEFORE deleting — the manifest holds ids, this holds the
  // data needed to put a row back.
  const snapshot: unknown[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await s.from("images").select("*").in("id", ids.slice(i, i + 200));
    if (error) throw error;
    snapshot.push(...(data ?? []));
  }
  console.log(`snapshot: ${snapshot.length} row(s) read back`);
  if (snapshot.length !== ids.length) {
    throw new Error(
      `refusing to proceed: asked for ${ids.length} rows, database returned ${snapshot.length}`
    );
  }

  const before = new Map<string, number>();
  for (const e of targets) {
    const { count } = await s
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", e.eventId);
    before.set(e.eventId, count ?? 0);
  }

  if (!apply) {
    console.log("\nDRY RUN — pass --apply to delete. Nothing written.");
    return;
  }

  fs.writeFileSync(BACKUP, JSON.stringify(snapshot, null, 2));
  console.log(`wrote ${BACKUP} (${snapshot.length} rows) before deleting anything`);

  let linksRemoved = 0;
  let rowsRemoved = 0;
  for (const e of targets) {
    const evIds = e.deletions.map((d) => d.remove);
    for (let i = 0; i < evIds.length; i += 100) {
      const slice = evIds.slice(i, i + 100);
      // Links first: a row with no membership is invisible, so if the second
      // delete failed we would leave orphans rather than dangling tiles.
      const { data: delLinks, error: linkErr } = await s
        .from("section_images")
        .delete()
        .in("image_id", slice)
        .select("image_id");
      if (linkErr) throw linkErr;
      linksRemoved += delLinks?.length ?? 0;

      const { data: delRows, error: rowErr } = await s
        .from("images")
        .delete()
        .in("id", slice)
        .select("id");
      if (rowErr) throw rowErr;
      rowsRemoved += delRows?.length ?? 0;
    }
    const { count: after } = await s
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", e.eventId);
    console.log(
      `  ${e.name.slice(0, 34).padEnd(34)} ${before.get(e.eventId)} → ${after} (removed ${e.deletions.length})`
    );
  }

  console.log(`\nremoved ${rowsRemoved} image row(s) and ${linksRemoved} section link(s).`);
  console.log(`Bytes left in R2 on purpose — ${BACKUP} + the objects make this reversible.`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
