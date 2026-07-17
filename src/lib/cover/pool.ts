import { createHash } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  getObjectMetadata,
  getPresignedDownloadUrl,
} from "@/lib/r2/client";
import type { CoverSettings } from "@/types/event-settings";
import { coverNeedsRaster } from "@/types/event-settings";
import { dedupeStackLeads } from "@/lib/cover/mosaic";
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
    const { data: images } = await supabase
      .from("images")
      .select("id, r2_key, parsed_name, original_filename, processing_status")
      .in("id", ids);
    const byId = new Map((images ?? []).map((img) => [img.id, img]));
    const rows = ids
      .map((id) => byId.get(id))
      .filter(
        (img): img is TileRow & { processing_status: string } =>
          !!img && img.processing_status === "complete"
      );
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
 * Hash of everything that shapes the raster: the cover settings + the tile
 * pool. If either drifts (photographer re-curates the section, tweaks the
 * overlay), the stored raster's hash no longer matches.
 */
export function coverInputsHash(cover: CoverSettings, tileIds: string[]): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
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
  cover: CoverSettings,
  expiresIn = 3600
): Promise<string | null> {
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
    currentHash = coverInputsHash(cover, leads.map((l) => l.id));
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
