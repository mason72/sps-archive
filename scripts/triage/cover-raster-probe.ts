/**
 * Scratch: is an event's stored cover raster stale? Compares the object's
 * inputs-hash metadata with the hash the composer would produce now, and
 * prints when the object was last written. Read-only.
 *
 *   npx tsx scripts/triage/cover-raster-probe.ts <eventId>
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
(async () => {
  const eventId = process.argv[2];
  const { createServiceClient } = await import("../../src/lib/supabase/server");
  const pool = await import("../../src/lib/cover/pool");
  const { getObjectMetadata } = await import("../../src/lib/r2/client");
  const { normalizeCoverSettings } = await import("../../src/types/event-settings");
  const supabase = createServiceClient();
  const { data: ev } = await supabase.from("events").select("settings").eq("id", eventId).single();
  const cover = normalizeCoverSettings(((ev!.settings ?? {}) as Record<string, unknown>).cover);
  const key = pool.coverRasterKey(eventId);
  const meta = await getObjectMetadata(key);
  const leads = pool.poolLeads(await pool.fetchMosaicPool(eventId, cover.mosaic?.sectionId));
  const current = pool.coverInputsHash(cover, leads.map(pool.tileHashKey));
  console.log({ key, type: cover.type, leads: leads.length, stored: meta?.["inputs-hash"] ?? null, current, stale: meta?.["inputs-hash"] !== current, meta });
})().catch((e) => { console.error(e); process.exit(1); });
