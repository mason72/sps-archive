/**
 * Restore two face-cluster names the pre-lesson-149 namer collapsed (lesson 153).
 *
 * The old `collapseRepeatedWords` ran after the CamelCase split and read a
 * doubled first name as a typo, so "DeeDeeAcquista_26-03-23_…" named its
 * cluster "Dee Acquista" and "SinhSinhAn_26-07-02_…" named its cluster
 * "Sinh An". Lesson 149 fixed the reader, but the namer is fill-nulls-only,
 * so stored names never change on their own.
 *
 * Provenance, checked 2026-09-14 because `persons` has no author column:
 * no identity suggestion of any status, no rejected names, and each stored
 * name is exactly what the old code produced from the cluster's own files
 * (19 of 20 Dee faces are DeeDeeAcquista frames, 1 stray David Hahn; all 13
 * Sinh faces are SinhSinhAn frames). Nobody typed these.
 *
 * The plan file is ALSO the undo ledger: [personId, eventId, oldName, newName],
 * committed before the first write. A row is written only while it still holds
 * the name it is leaving, so a human edit since the plan wins. The name key
 * changes (deeacquista → deedeeacquista), so each touched event gets the scoped
 * reference refresh, which re-keys that cluster's reference centroid.
 *
 *   npx tsx scripts/restore-doubled-cluster-names.ts            # dry run
 *   npx tsx scripts/restore-doubled-cluster-names.ts --apply    # write
 *   npx tsx scripts/restore-doubled-cluster-names.ts --undo     # restore old names
 *
 * ⚠️ .env.local points at PRODUCTION.
 */
import fs from "node:fs";

import { createServiceClient } from "@/lib/supabase/server";
import { NON_PERSON_GALLERIES } from "@/lib/people/index-people";

try {
  process.loadEnvFile(".env.local");
} catch {
  // Environment may already be populated.
}

const PLAN = "tasks/restore-doubled-cluster-names-2026-09-14.json";
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");

async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN, "utf8")) as [string, string, string, string][];
  const db = createServiceClient();
  const ids = plan.map(([id]) => id);

  const { data: current, error } = await db.from("persons").select("id, name").in("id", ids);
  if (error) throw error;
  const nameNow = new Map((current ?? []).map((p) => [p.id, p.name]));
  const from = (row: [string, string, string, string]) => (UNDO ? row[3] : row[2]);
  const to = (row: [string, string, string, string]) => (UNDO ? row[2] : row[3]);
  const ready = plan.filter((row) => nameNow.get(row[0]) === from(row));
  console.log(`${plan.length} in plan, ${ready.length} ready (the rest changed since)`);
  for (const row of plan) {
    const mark = ready.includes(row) ? "ready" : `skip, now ${JSON.stringify(nameNow.get(row[0]))}`;
    console.log(`  ${row[0]}: ${JSON.stringify(from(row))} → ${JSON.stringify(to(row))} (${mark})`);
  }
  if (!APPLY && !UNDO) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const row of ready) {
    const { data, error: upErr } = await db
      .from("persons")
      .update({ name: to(row) })
      .eq("id", row[0])
      .eq("name", from(row))
      .select("id");
    if (upErr) throw upErr;
    written += data?.length ?? 0;
  }
  console.log(`${UNDO ? "restored" : "renamed"} ${written}`);

  const events = [...new Set(ready.map(([, eventId]) => eventId))];
  const { data: evRows, error: evErr } = await db.from("events").select("id, user_id, name").in("id", events);
  if (evErr) throw evErr;
  for (const ev of evRows ?? []) {
    const { data: n, error: rErr } = await db.rpc("refresh_person_reference_centroids", {
      p_user_id: ev.user_id,
      p_event_id: ev.id,
      p_excluded_event_names: [...NON_PERSON_GALLERIES],
    });
    if (rErr) throw rErr;
    console.log(`  refreshed references for ${ev.name}: ${n} named clusters`);
  }

  const { data: after, error: afterErr } = await db.from("persons").select("id, name").in("id", ids);
  if (afterErr) throw afterErr;
  for (const p of after ?? []) console.log(`check: ${p.id} = ${JSON.stringify(p.name)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
