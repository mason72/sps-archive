/**
 * Read-only parity check: does the raster's cover pool (fetchMosaicCoverPool)
 * equal the pool the gallery computes (pickMosaicPool over a replay of the
 * payload's reads) for an event? Prints both sources, sizes and the first
 * mismatch, if any.
 *   npx tsx scripts/triage/mosaic-pool-parity.ts <eventId> [...]
 */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
import { createServiceClient } from "@/lib/supabase/server";
import { fetchMosaicCoverPool, poolLeads } from "@/lib/cover/pool";
import { loadSectionLinks } from "@/lib/sections/gallery-members";
import { readAllRows } from "@/lib/supabase/paged";
import { normalizeCoverSettings } from "@/types/event-settings";
import {
  MOSAIC_POOL_CAP,
  mosaicLeadsNeeded,
  orderEveryPhoto,
  pickMosaicPool,
} from "@/lib/cover/mosaic";

async function one(eventId: string) {
  const sb = createServiceClient();
  const { data: ev } = await sb.from("events").select("name, settings").eq("id", eventId).single();
  const cover = normalizeCoverSettings((ev?.settings as Record<string, unknown>)?.cover);
  const rows = cover.mosaic?.rows ?? 3;
  const sectionId = cover.mosaic?.sectionId;

  // Server side.
  const server = await fetchMosaicCoverPool(eventId, { sectionId, rows });

  // Gallery side, replaying the payload's reads: displayable, non-cover
  // images; sections in sort_order with their links in link order.
  const images = await readAllRows(() =>
    sb
      .from("images")
      .select("id, original_filename, parsed_name, media_type")
      .eq("event_id", eventId)
      .eq("thumbnail_generated", true)
      .eq("is_cover_upload", false)
  );
  const byId = new Map(images.map((i) => [i.id, i]));
  const { data: sections } = await sb
    .from("sections")
    .select("id, name")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  const links = await loadSectionLinks(sb, (sections ?? []).map((s) => s.id));
  const idsBySection = new Map<string, string[]>();
  for (const l of links) {
    if (!idsBySection.has(l.section_id)) idsBySection.set(l.section_id, []);
    idsBySection.get(l.section_id)!.push(l.image_id);
  }
  type G = { id: string; originalFilename: string; parsedName: string | null; mediaType: string | null };
  const toG = (i: (typeof images)[number]): G => ({
    id: i.id,
    originalFilename: i.original_filename,
    parsedName: i.parsed_name,
    mediaType: i.media_type,
  });
  const candidates = (sections ?? [])
    .map((s) => ({
      id: s.id,
      images: (idsBySection.get(s.id) ?? [])
        .slice(0, MOSAIC_POOL_CAP)
        .map((id) => byId.get(id))
        .filter((x): x is NonNullable<typeof x> => !!x && x.media_type !== "video")
        .map(toG),
    }))
    .filter((c) => c.images.length > 0);
  const everyPhoto = orderEveryPhoto(images.filter((i) => i.media_type !== "video").map(toG));
  const gallery = pickMosaicPool({
    sectionId,
    sections: candidates,
    everyPhoto,
    minLeads: mosaicLeadsNeeded(rows),
  });

  const serverIds = server.map((r) => r.id);
  const galleryIds = gallery.pool.map((g) => g.id);
  const same = serverIds.length === galleryIds.length && serverIds.every((id, i) => id === galleryIds[i]);
  const firstDiff = serverIds.findIndex((id, i) => id !== galleryIds[i]);
  const name = (sections ?? []).find((s) => s.id === gallery.sectionId)?.name;
  console.log(
    `${ev?.name} | rows ${rows} | chosen ${sectionId ?? "-"} | gallery picks ${gallery.source}${name ? ` "${name}"` : ""}: ${galleryIds.length} photos, ${poolLeads(server).length} leads | server ${serverIds.length} | ${same ? "IDENTICAL" : `DIFFER at index ${firstDiff}`}`
  );
  return same;
}

async function main() {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("pass event ids");
  let ok = true;
  for (const id of ids) ok = (await one(id)) && ok;
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
