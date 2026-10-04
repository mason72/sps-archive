/**
 * Capacity check, by hand: the same reading and the same judgment the hourly
 * `capacity-check` job makes (src/lib/monitoring/capacity.ts), printed.
 *
 *   npx tsx scripts/capacity-check.ts            # read and assess; writes nothing, emails nothing
 *   npx tsx scripts/capacity-check.ts --history  # also print the stored trend (one row per check)
 *
 * Run this FIRST when anything is slow, stuck or timing out. On 2026-10-04 a
 * gallery sat at "Queued" for a day because the database had outgrown its
 * memory, and two hours of looking at queues came before one look at this.
 *
 * ⚠️ .env.local points at PRODUCTION. This only reads.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const GB = 1024 ** 3;
const MB = 1024 ** 2;

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { runCapacityCheck, computeSizeFor, formatFinding } = await import(
    "../src/lib/monitoring/capacity"
  );
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as Parameters<typeof runCapacityCheck>[0];

  const { snapshot, findings } = await runCapacityCheck(supabase, {
    notify: false,
    aiEnabled: process.env.AI_INDEXING_ENABLED === "true",
  });
  const { capacity: c, backlog: b } = snapshot;

  if (c) {
    const size = computeSizeFor(c.shared_buffers_bytes);
    const pct = (a: number, of: number) => `${Math.round((a / of) * 100)}%`;
    console.log(`Database size      ${(c.db_bytes / GB).toFixed(1)} GB  (${pct(c.db_bytes, size.maxDbGb * GB)} of the ${size.maxDbGb} GB recommended for ${size.name})`);
    console.log(`Compute            ${size.name}, ${size.ramGb} GB memory, about $${size.monthlyUsd}/month`);
    console.log(`Vector indexes     ${Math.round(c.vector_index_bytes / MB)} MB  (${pct(c.vector_index_bytes, c.effective_cache_bytes)} of ${Math.round(c.effective_cache_bytes / MB)} MB cacheable memory)`);
    console.log(`Connections        ${c.connections} of ${c.max_connections}`);
    console.log(`Timeouts, 6h       ${c.timeouts_6h}  ${JSON.stringify(c.timeout_contexts_6h)}`);
    console.log(`Sweep failures, 2h ${c.sweep_failures_2h}`);
  }
  if (b) {
    const days = b.indexed_24h > 0 ? (b.backlog_photos / b.indexed_24h).toFixed(1) : "n/a";
    console.log(`AI backlog         ${b.backlog_photos.toLocaleString("en-US")} photos in ${b.backlog_events} galleries`);
    console.log(`Indexed, 24h       ${b.indexed_24h.toLocaleString("en-US")}  (${days} days to clear at that pace)`);
    console.log(`Last indexed       ${b.newest_indexed_at ?? "never"}`);
  }
  for (const e of snapshot.errors) console.log(`COULD NOT READ     ${e}`);

  console.log("");
  if (!findings.length) console.log("No findings: nothing is near a limit.");
  for (const f of findings) console.log(formatFinding(f) + "\n");

  if (process.argv.includes("--history")) {
    const { data, error } = await supabase
      .from("capacity_snapshots")
      .select("taken_at, data")
      .order("taken_at", { ascending: false })
      .limit(48);
    if (error) throw new Error(`history: ${error.message}`);
    console.log("taken_at              db GB  vector MB  timeouts  backlog  indexed/24h");
    for (const row of data ?? []) {
      const d = row.data as { capacity?: typeof c; backlog?: typeof b };
      console.log(
        [
          String(row.taken_at).slice(0, 19),
          d.capacity ? (d.capacity.db_bytes / GB).toFixed(1).padStart(6) : "     ?",
          d.capacity ? String(Math.round(d.capacity.vector_index_bytes / MB)).padStart(9) : "        ?",
          d.capacity ? String(d.capacity.timeouts_6h).padStart(8) : "       ?",
          d.backlog ? String(d.backlog.backlog_photos).padStart(8) : "       ?",
          d.backlog ? String(d.backlog.indexed_24h).padStart(11) : "          ?",
        ].join("  ")
      );
    }
  }

  // Non-zero when something needs a person, so a hook or a cron can act on it.
  if (findings.some((f) => f.severity === "critical")) process.exit(2);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
