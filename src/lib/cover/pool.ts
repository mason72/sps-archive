import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getObjectMetadata,
  getPresignedDownloadUrl,
} from "@/lib/r2/client";
import type { CoverSettings } from "@/types/event-settings";
import { coverNeedsRaster, sanitizeCoverForEvent } from "@/types/event-settings";
import { dedupeStackLeads, MOSAIC_LAYOUT_VERSION } from "@/lib/cover/mosaic";
import { inngest } from "@/lib/inngest/client";

/**
 * Sharp-free half of the cover raster pipeline: tile-pool resolution, input
 * hashing, and serve-time raster URL resolution. Request routes (email
 * cover, OG) import THIS module; the sharp composer lives in raster.ts and
 * only ever runs inside the Inngest job.
 */

export function coverRasterKey(eventId: string): string {
  return `events/${eventId}/covers/cover-raster.jpg`;
}

export interface TileRow {
  id: string;
  r2_key: string;
  parsed_name: string | null;
  original_filename: string;
  width: number | null;
  height: number | null;
  /** Subject anchor (0–100) — face-derived or manual; crops center on it. */
  focal_x: number | null;
  focal_y: number | null;
}

/** The section image rows a mosaic/crossfade would draw from, in section order. */
export async function fetchMosaicPool(
  eventId: string,
  sectionId: string | undefined
): Promise<TileRow[]> {
  const supabase = createServiceClient();

  const { data: sections } = await supabase
    .from("sections")
    .select("id")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true });
  if (!sections || sections.length === 0) return [];

  const targetIds =
    sectionId && sections.some((s) => s.id === sectionId)
      ? [sectionId]
      : sections.map((s) => s.id);

  // Walk sections in order; first one with members wins (mirrors the client's
  // "chosen section, else first section with images" resolution).
  for (const sid of targetIds) {
    const { data: links } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", sid)
      .order("sort_order", { ascending: true })
      .order("image_id", { ascending: true })
      .limit(500);
    if (!links || links.length === 0) continue;

    const ids = links.map((l) => l.image_id);
    // Displayable = thumbnail exists — same gate as the public gallery
    // payload the live mosaic tiles from. Gating on processing_status
    // instead silently drops photos whose (hidden) AI step failed, and any
    // pool difference reorders the ENTIRE seeded arrangement, desyncing the
    // raster from the live cover.
    const { data: images } = await supabase
      .from("images")
      .select(
        "id, r2_key, parsed_name, original_filename, width, height, media_type, focal_x, focal_y"
      )
      .in("id", ids)
      .eq("thumbnail_generated", true);
    const byId = new Map((images ?? []).map((img) => [img.id, img]));
    const rows: TileRow[] = [];
    for (const id of ids) {
      const img = byId.get(id);
      if (img && img.media_type !== "video") rows.push(img);
    }
    if (rows.length > 0) return rows;
  }
  return [];
}

/** Pool rows → stack-deduped leads (adapts DB casing for the shared engine). */
export function poolLeads(pool: TileRow[]): TileRow[] {
  return dedupeStackLeads(
    pool.map((row) => ({
      ...row,
      parsedName: row.parsed_name,
      originalFilename: row.original_filename,
    }))
  );
}

/**
 * Per-tile hash key: identity + its crop anchor. A focal point written after
 * composition (face scan landing, manual pick) must read as drift — the tile
 * crops change with it.
 */
export function tileHashKey(t: {
  id: string;
  focal_x: number | null;
  focal_y: number | null;
}): string {
  return `${t.id}:${t.focal_x ?? ""}:${t.focal_y ?? ""}`;
}

/**
 * Hash of everything that shapes the raster: the cover settings + the tile
 * pool (identity AND focal anchors). If any drifts (section re-curated,
 * overlay tweaked, face scan landed), the stored raster's hash no longer
 * matches.
 */
export function coverInputsHash(cover: CoverSettings, tileIds: string[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        // Layout algorithm version: deployed layout changes must lazily
        // regenerate stored rasters, not serve the old arrangement forever.
        v: MOSAIC_LAYOUT_VERSION,
        type: cover.type,
        mosaic: cover.type === "mosaic" ? cover.mosaic : undefined,
        solid: cover.type === "solid" ? cover.solid : undefined,
        tileIds,
      })
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Serve-time resolution: presigned URL for the stored raster if one exists,
 * with a lazy staleness check — when the stored inputs hash no longer matches
 * (section re-curated, settings changed out-of-band), a refresh is enqueued
 * while the stale raster still serves (stale-while-revalidate).
 */
export async function resolveCoverRasterUrl(
  eventId: string,
  rawCover: CoverSettings,
  expiresIn = 3600
): Promise<string | null> {
  // Same sanitization the composer applies — the two hash computations must
  // see identical settings or a bogus logoKey loops regeneration forever.
  const cover = sanitizeCoverForEvent(eventId, rawCover);
  if (!coverNeedsRaster(cover)) return null;
  const key = coverRasterKey(eventId);
  const meta = await getObjectMetadata(key);

  if (meta === null) {
    // Nothing rendered yet (pre-pipeline covers, or a failed job) — enqueue.
    await inngest
      .send({ name: "cover/raster.generate", data: { eventId } })
      .catch(() => {});
    return null;
  }

  // Staleness probe: recompute the tile pool hash only for mosaic (solid's
  // inputs are entirely inside settings).
  let currentHash: string;
  if (cover.type === "mosaic") {
    const leads = poolLeads(await fetchMosaicPool(eventId, cover.mosaic?.sectionId));
    currentHash = coverInputsHash(cover, leads.map(tileHashKey));
  } else {
    currentHash = coverInputsHash(cover, []);
  }
  if (meta["inputs-hash"] !== currentHash) {
    await inngest
      .send({ name: "cover/raster.generate", data: { eventId } })
      .catch(() => {});
  }

  return getPresignedDownloadUrl(key, expiresIn);
}
