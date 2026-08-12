/**
 * Write face-based focal points for an event's images that have none.
 *
 * Why this exists: `repair-shifted-bytes.ts` NULLED focal_x/focal_y for every
 * repaired row, correctly — they had been computed against the wrong person's
 * pixels. But nothing puts them back. Focal is its own lane
 * (Inngest `focal/auto.suggest` → `ensureAutoFocal`) and per
 * src/lib/inngest/functions.ts it is an OPT-IN chore, not part of AI indexing,
 * so the re-index that followed the repair restored embeddings and faces and
 * left 804 Island photos with no crop anchor.
 *
 * Drives the SAME module the Inngest job calls rather than reimplementing the
 * write, so there is one definition of what a focal point is.
 *
 * `ensureAutoFocal` fills NULLS ONLY and re-checks `.is("focal_x", null)` on
 * write, so a manual pick made while this runs is never clobbered, and a
 * re-run is a no-op rather than a second opinion.
 *
 *   npx tsx scripts/triage/backfill-focal.ts <eventId>          # dry run
 *   npx tsx scripts/triage/backfill-focal.ts <eventId> --apply
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const BATCH = 100;

async function main() {
  const eventId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!eventId) throw new Error("usage: backfill-focal.ts <eventId> [--apply]");

  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const { ensureAutoFocal } = await import("../../src/lib/faces/ensure-focal");
  const s = createServiceClient();

  const { data: event } = await s
    .from("events")
    .select("name")
    .eq("id", eventId)
    .single();

  const { data: rows, error } = await s
    .from("images")
    .select("id, r2_key")
    .eq("event_id", eventId)
    .is("focal_x", null)
    .limit(5000);
  if (error) throw error;

  const images = rows ?? [];
  console.log(`${event?.name ?? eventId}: ${images.length} image(s) with no focal point`);

  if (!apply) {
    console.log("DRY RUN — pass --apply to write.");
    return;
  }

  let written = 0;
  for (let i = 0; i < images.length; i += BATCH) {
    const slice = images.slice(i, i + BATCH);
    // scanCap 0: every candidate already carries face rows (re-detected after
    // the repair), so this run reads faces and writes focal without calling
    // Modal at all. A candidate with no faces simply gets no suggestion and is
    // left for a later run rather than silently receiving a centred default.
    const n = await ensureAutoFocal(s, slice, { scanCap: 0 });
    written += n;
    console.log(`  ${Math.min(i + BATCH, images.length)}/${images.length} — ${written} written`);
  }

  const { count: remaining } = await s
    .from("images")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId)
    .is("focal_x", null);

  console.log(`\nwrote ${written}; ${remaining} still without a focal point.`);
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
