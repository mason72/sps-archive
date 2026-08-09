/**
 * AI-index backfill driver (tasks/todo.md "AI revival" Phase 0).
 *
 * Drives src/lib/ai-index/index-event.ts directly (same code the Inngest job
 * runs) so a backfill doesn't crawl through the 15m settlement debounce.
 * Writes ONLY the AI columns + faces rows — the module's invariant.
 *
 * Usage:
 *   npx tsx scripts/backfill-ai-index.ts --event <eventId>   # one event
 *   npx tsx scripts/backfill-ai-index.ts --all               # whole archive
 *   npx tsx scripts/backfill-ai-index.ts --status            # counts only
 *
 * Events with pending (in-flight) uploads are skipped, same as the job.
 * Modal GPU cost: ~$0.60/hr on T4, roughly 1-2k images per GPU-hour.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { indexEventBatch, countPendingUploads } = await import(
    "../src/lib/ai-index/index-event"
  );
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  ) as unknown as Parameters<typeof indexEventBatch>[0];

  if (!process.env.MODAL_AI_INDEX_URL || !process.env.VIDEO_PIPELINE_KEY) {
    throw new Error("MODAL_AI_INDEX_URL / VIDEO_PIPELINE_KEY missing");
  }

  const args = process.argv.slice(2);
  const eventArg = args.includes("--event") ? args[args.indexOf("--event") + 1] : null;
  const all = args.includes("--all");
  const statusOnly = args.includes("--status");

  // Which events have work? (paged — PostgREST caps a request at 1000 rows)
  const counts = new Map<string, number>();
  for (let page = 0; ; page++) {
    const { data: rows, error } = await supabase
      .from("images")
      .select("event_id")
      .is("ai_indexed_at", null)
      .eq("thumbnail_generated", true)
      .eq("media_type", "image")
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const r of rows ?? []) counts.set(r.event_id, (counts.get(r.event_id) ?? 0) + 1);
    if (!rows || rows.length < 1000) break;
  }

  const { data: events } = await supabase
    .from("events")
    .select("id, name")
    .in("id", [...counts.keys()]);
  const nameOf = new Map((events ?? []).map((e) => [e.id, e.name]));

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`${total} unindexed images across ${counts.size} events`);
  if (statusOnly) {
    for (const [id, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(n).padStart(6)}  ${nameOf.get(id) ?? id}`);
    return;
  }

  const targets = eventArg ? [eventArg] : all ? [...counts.keys()] : [];
  if (!targets.length) {
    console.log("Pass --event <id>, --all, or --status.");
    return;
  }

  const t0 = Date.now();
  let done = 0;
  for (const eventId of targets) {
    const label = nameOf.get(eventId) ?? eventId;
    const pending = await countPendingUploads(supabase, eventId);
    if (pending > 0) {
      console.log(`SKIP "${label}" — ${pending} uploads in flight`);
      continue;
    }
    for (;;) {
      const r = await indexEventBatch(supabase, eventId);
      done += r.indexed;
      for (const [id, msg] of Object.entries(r.errors)) console.log(`  ✗ ${id}: ${msg}`);
      const rate = done / Math.max(1, (Date.now() - t0) / 1000);
      console.log(
        `"${label}": +${r.indexed} (${r.faces} faces), ${r.remaining} left ` +
          `[${done}/${total} total, ${rate.toFixed(1)}/s]`
      );
      if (r.remaining === 0 || r.indexed === 0) break;
    }
  }
  console.log(`\nDone: ${done} indexed in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
}

main().catch((err) => {
  console.error("FAILED:", err.message ?? err);
  process.exit(1);
});
