import fs from "node:fs";
for (const l of fs.readFileSync(".env.local","utf8").split("\n")) { const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]]===undefined) process.env[m[1]]=m[2]; }

/**
 * Apply what `date-hints.ts` proposes.
 *
 * Writes the originals to disk BEFORE the first update, not alongside it: a
 * rename with no way back is not a reversible operation, and the backup is
 * worthless if it is written after the thing it backs up.
 *
 * Re-reads each row and compares to what the proposal was computed from, so a
 * name edited in the UI since the dry run is skipped rather than clobbered.
 */
const BACKUP = "tasks/name-rename-backup.json";

async function main(){
  const apply = process.argv.includes("--apply");
  const P = await import("../../src/lib/event-intel/parse-calendar");
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  const { data: events, error } = await db
    .from("events").select("id,name,sort_date")
    .order("sort_date", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);

  const plan: { id: string; from: string; to: string }[] = [];
  for (const e of events ?? []) {
    const s = P.suggestEventName(e.name, { client: e.name, date: e.sort_date });
    const to = s.dateHint ? `${s.suggested} ${s.dateHint}` : s.suggested;
    if (to !== e.name) plan.push({ id: e.id, from: e.name, to });
  }

  if (!apply) {
    for (const p of plan) console.log(`  ${p.from}\n    → ${p.to}`);
    console.log(`\n${plan.length} would change. Re-run with --apply`);
    return;
  }

  fs.writeFileSync(BACKUP, JSON.stringify({ at: new Date().toISOString(), plan }, null, 2));
  console.log(`originals → ${BACKUP}\n`);

  let ok = 0, skipped = 0;
  for (const p of plan) {
    const { data: live } = await db.from("events").select("name").eq("id", p.id).single();
    if (!live || live.name !== p.from) {
      console.log(`  ⤬ ${p.id} now reads "${live?.name}" — skipped, not clobbered`);
      skipped++; continue;
    }
    const { error: err } = await db
      .from("events").update({ name: p.to, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (err) { console.error(`  ✗ ${p.to}: ${err.message}`); skipped++; continue; }
    console.log(`  ✓ ${p.to}`);
    ok++;
  }
  console.log(`\n${ok} renamed, ${skipped} skipped`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
