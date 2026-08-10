/**
 * One-time person-clustering sweep over every event with embedded faces
 * (companion to backfill-ai-index.ts; organic events cluster via Inngest).
 * Incremental + name-preserving, safe to re-run.
 *
 *   npx tsx scripts/cluster-all-events.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { clusterEventFaces } = await import("../src/lib/faces/cluster-event");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as Parameters<typeof clusterEventFaces>[0];

  const { data: events, error } = await supabase.from("events").select("id, name");
  if (error) throw error;

  for (const ev of events ?? []) {
    const t0 = Date.now();
    const r = await clusterEventFaces(supabase, ev.id);
    if (r.totalFaces === 0) continue;
    console.log(
      `"${ev.name}": ${r.totalFaces} faces → +${r.personsCreated} persons, ` +
        `${r.assignedToExisting} joined existing, ${r.unassigned} unassigned ` +
        `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
    );
  }
  console.log("done");
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
