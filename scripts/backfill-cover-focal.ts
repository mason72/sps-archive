/**
 * One-time backfill: face-based focal points for every event whose cover is
 * enabled (covers saved before the cover-focal job existed never got
 * scanned). Same fill-nulls contract as everywhere else; detection capped
 * per event. Stored mosaic/solid rasters regenerate lazily via the
 * focal-aware inputs hash on their next serve.
 *
 *   npx tsx scripts/backfill-cover-focal.ts          # dry-run (report only)
 *   npx tsx scripts/backfill-cover-focal.ts --write  # detect + write
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const WRITE = process.argv.includes("--write");

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { normalizeCoverSettings } = await import("../src/types/event-settings");
  const { fetchMosaicPool, poolLeads } = await import("../src/lib/cover/pool");
  const { ensureAutoFocal } = await import("../src/lib/faces/ensure-focal");
  const supabase = createServiceClient();

  const { data: events } = await supabase
    .from("events")
    .select("id, name, settings")
    .order("created_at", { ascending: false })
    .limit(200);

  let totalWritten = 0;
  for (const ev of events ?? []) {
    const cover = normalizeCoverSettings(
      ((ev.settings ?? {}) as Record<string, unknown>).cover
    );
    if (!cover.enabled) continue;

    const targets: Array<{ id: string; r2_key: string }> = [];
    if (cover.type === "image" && cover.imageId) {
      const { data: img } = await supabase
        .from("images")
        .select("id, r2_key, focal_x")
        .eq("id", cover.imageId)
        .single();
      if (img && img.focal_x == null) targets.push(img);
    } else if (cover.type === "mosaic" || cover.type === "crossfade") {
      const sectionId =
        cover.type === "mosaic" ? cover.mosaic?.sectionId : cover.crossfade?.sectionId;
      targets.push(
        ...poolLeads(await fetchMosaicPool(ev.id, sectionId)).filter(
          (l) => l.focal_x == null
        )
      );
    }
    if (targets.length === 0) continue;

    if (!WRITE) {
      console.log(`[dry] "${ev.name}" (${cover.type}): ${targets.length} unanchored`);
      continue;
    }
    const written = await ensureAutoFocal(supabase, targets, { scanCap: 80 });
    totalWritten += written;
    console.log(`"${ev.name}" (${cover.type}): wrote ${written}/${targets.length}`);
  }
  console.log(WRITE ? `Done — ${totalWritten} focal points written.` : "Dry run done.");
}

main().catch((err) => {
  console.error("BACKFILL FAILED:", err);
  process.exit(1);
});
