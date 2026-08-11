/**
 * Proves what the archive cards will actually show, per event: the composed
 * raster for mosaic/color covers, the chosen photo otherwise, and the crop
 * anchor. Written after cards showed stale covers and beheaded headshots
 * (2026-08-10).
 *
 *   npx tsx scripts/verify-event-covers.ts
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { enrichEvents } = await import("../src/lib/events/enrich");
  const supabase = createServiceClient();

  const { data: events, error } = await supabase
    .from("events")
    .select("id, name, settings")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;

  const enrichment = await enrichEvents(
    supabase,
    (events ?? []) as Parameters<typeof enrichEvents>[1]
  );

  let rasters = 0;
  let anchored = 0;
  for (const e of events ?? []) {
    const r = enrichment.get(e.id);
    const type =
      ((e.settings as Record<string, unknown>)?.cover as { type?: string })
        ?.type ?? "(none)";
    const shows = r?.coverThumbnailUrl?.includes("cover-raster")
      ? "RASTER"
      : r?.coverThumbnailUrl
        ? "photo"
        : "NONE";
    if (shows === "RASTER") rasters++;
    if (r?.coverFocal) anchored++;
    console.log(
      `${e.name.slice(0, 34).padEnd(35)} cover=${String(type).padEnd(10)} shows=${shows.padEnd(7)} focal=${
        r?.coverFocal ? `${r.coverFocal.x},${r.coverFocal.y}` : "— (biases high)"
      }`
    );
  }
  console.log(
    `\n${events?.length ?? 0} events · ${rasters} composed rasters · ${anchored} face-anchored`
  );
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
