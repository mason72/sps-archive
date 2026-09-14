/**
 * Clear face-cluster names the old filename namer wrote and the current one
 * refuses (lesson 148, approved by Mason 2026-09-14: "Clear the 40 junk").
 *
 * The plan file is ALSO the undo ledger: [personId, eventId, oldName] rows,
 * committed before the first write. It holds the 40 names
 * `scripts/triage/cluster-namer-parity.ts` found were written automatically
 * (no confirmed suggestion; equal to the old namer's consensus) and that
 * `frameName` would not write today: 24 fused DATADOG tags ("Lauren Smith
 * Data Dog Headshots"), 4 PG&E suffixes ("Jim H01"), and 12 gallery labels in
 * the marketing galleries. Five correct names the wall's parser misreads
 * (Lisa OBrien, …) were left out on purpose.
 *
 * A row is cleared only when `persons.name` still holds the old name, so a
 * human edit since the plan wins. `rejected_names` is NOT written: that is a
 * human's memory, and the agreement rule already keeps the namer from
 * refilling these. Each touched event then gets the scoped reference refresh,
 * which drops the cleared clusters from `person_reference_centroids`.
 *
 *   npx tsx scripts/clear-junk-cluster-names.ts            # dry run
 *   npx tsx scripts/clear-junk-cluster-names.ts --apply    # write
 *   npx tsx scripts/clear-junk-cluster-names.ts --undo     # restore old names
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

const PLAN = "tasks/clear-junk-cluster-names-2026-09-14.json";
const APPLY = process.argv.includes("--apply");
const UNDO = process.argv.includes("--undo");

async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN, "utf8")) as [string, string, string][];
  const db = createServiceClient();
  const ids = plan.map(([id]) => id);

  const { data: current, error } = await db.from("persons").select("id, name").in("id", ids);
  if (error) throw error;
  const nameNow = new Map((current ?? []).map((p) => [p.id, p.name]));
  const ready = plan.filter(([id, , old]) => (UNDO ? nameNow.get(id) === null : nameNow.get(id) === old));
  console.log(`${plan.length} in plan, ${ready.length} ready to ${UNDO ? "restore" : "clear"} (the rest changed since)`);
  const readyIds = new Set(ready.map(([id]) => id));
  for (const [id, , old] of plan) {
    if (!readyIds.has(id)) console.log(`  skip ${id}: now ${JSON.stringify(nameNow.get(id))}, plan ${JSON.stringify(old)}`);
  }
  if (!APPLY && !UNDO) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  let written = 0;
  for (const [id, , old] of ready) {
    const q = db.from("persons").update({ name: UNDO ? old : null }).eq("id", id);
    const { data, error: upErr } = await (UNDO ? q.is("name", null) : q.eq("name", old)).select("id");
    if (upErr) throw upErr;
    written += data?.length ?? 0;
  }
  console.log(`${UNDO ? "restored" : "cleared"} ${written}`);

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

  const [{ count: named }, { count: refs }] = await Promise.all([
    db.from("persons").select("id", { count: "exact", head: true }).in("id", ids).not("name", "is", null),
    db.from("person_reference_centroids").select("person_id", { count: "exact", head: true }).in("person_id", ids),
  ]);
  console.log(`check: ${named} of the plan still named, ${refs} still reference centroids`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
