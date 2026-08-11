import {
  getObjectMetadata,
  getPresignedDownloadUrl,
  getThumbnailKey,
} from "@/lib/r2/client";
import { coverRasterKey } from "@/lib/cover/pool";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServiceClient>;

/** Minimal event shape the enrichment needs. */
export interface EnrichableEvent {
  id: string;
  settings: unknown;
  [key: string]: unknown;
}

/**
 * The cover image id a card should use, or undefined when the event's cover
 * isn't a photo.
 *
 * `settings.cover.imageId` is NOT cleared when the photographer switches the
 * cover to mosaic/color/fade, so reading it unconditionally showed a stale,
 * unrelated photo on the archive card long after the real cover changed
 * (Justin, 2026-08-10). Non-photo covers fall back to the event's first
 * image — a real frame from the event, and free (already batched).
 */
export function coverImageIdFor(e: { settings?: unknown }): string | undefined {
  const settings = (e.settings ?? {}) as Record<string, unknown>;
  const cover = settings.cover as { type?: string; imageId?: string } | undefined;
  if (!cover?.imageId) return undefined;
  // Legacy rows have no type and are photo covers by definition.
  return cover.type === undefined || cover.type === "image"
    ? cover.imageId
    : undefined;
}

export interface EventEnrichment {
  /** Presigned cover thumbnail URL (settings cover → earliest image fallback). */
  coverThumbnailUrl: string | null;
  /**
   * Crop anchor for that thumbnail, 0–100 in each axis, or null for a
   * composed raster (already framed) / an image with no anchor. Cards render
   * object-cover, so without this a headshot card crops through the face.
   */
  coverFocal: { x: number; y: number } | null;
  /** Active share slug (newest "full" share, else newest of any type). */
  activeShareSlug: string | null;
}

/**
 * Resolve cover-thumbnail + active-share-slug for a page of events using a
 * FIXED number of batched queries (was ~3 per event — an N+1 that made the
 * dashboard crawl for photographers with many events):
 *   1. cover images by id (one .in())
 *   2. earliest image per remaining event (one DISTINCT ON RPC)
 *   3. active shares for all events (one .in())
 * Presigning is local HMAC, so it parallelizes without DB round-trips.
 */
export async function enrichEvents(
  supabase: SupabaseClient,
  events: EnrichableEvent[]
): Promise<Map<string, EventEnrichment>> {
  const result = new Map<string, EventEnrichment>();
  if (events.length === 0) return result;

  const eventIds = events.map((e) => e.id);

  // The r2_key to use as each event's cover.
  const coverKeyByEvent = new Map<string, string>();
  // Crop anchors (0–100) for keys that are photos. A composed raster is
  // already framed, so it gets no anchor.
  const focalByEvent = new Map<string, { x: number; y: number }>();
  // Keys that are pre-composed rasters — presigned as-is, no thumbnail path.
  const rasterEvents = new Set<string>();

  // 1. Explicit cover images (settings.cover.imageId), one query.
  //
  // ONLY for photo-type covers. `imageId` is not cleared when the
  // photographer switches to mosaic/color/fade, so honoring it regardless of
  // type made the archive card show a stale, unrelated photo long after the
  // real cover changed (Justin, 2026-08-10). Raster covers are resolved in 1b.
  const coverImageIds = events
    .map(coverImageIdFor)
    .filter((id): id is string => !!id);

  const coverKeyById = new Map<string, string>();
  const focalById = new Map<string, { x: number; y: number }>();
  if (coverImageIds.length > 0) {
    const { data: coverImgs } = await supabase
      .from("images")
      .select("id, r2_key, focal_x, focal_y")
      .in("id", coverImageIds);
    for (const img of coverImgs ?? []) {
      coverKeyById.set(img.id, img.r2_key);
      if (img.focal_x != null && img.focal_y != null) {
        focalById.set(img.id, { x: img.focal_x, y: img.focal_y });
      }
    }
  }
  for (const e of events) {
    const imageId = coverImageIdFor(e);
    const key = imageId ? coverKeyById.get(imageId) : undefined;
    if (key) {
      coverKeyByEvent.set(e.id, key);
      const f = imageId ? focalById.get(imageId) : undefined;
      if (f) focalByEvent.set(e.id, f);
    }
  }

  // 1b. Raster covers (mosaic/color): show the COMPOSED cover, which is what
  // the gallery actually displays — a photo fallback here is why the card
  // looked "stuck" after switching cover type. One parallel R2 HEAD per
  // raster-cover event, and deliberately NOT resolveCoverRasterUrl: that
  // enqueues a compose job on a miss, which a list route must never do.
  const rasterCandidates = events.filter((e) => {
    const cover = ((e.settings ?? {}) as Record<string, unknown>).cover as
      | { type?: string }
      | undefined;
    return (
      !coverKeyByEvent.has(e.id) &&
      (cover?.type === "mosaic" || cover?.type === "solid")
    );
  });
  await Promise.all(
    rasterCandidates.map(async (e) => {
      const key = coverRasterKey(e.id);
      const meta = await getObjectMetadata(key).catch(() => null);
      if (meta !== null) {
        coverKeyByEvent.set(e.id, key);
        rasterEvents.add(e.id);
      }
    })
  );

  // 2. Fallback: earliest image per event (one round-trip) for the rest.
  const needFallback = eventIds.filter((id) => !coverKeyByEvent.has(id));
  if (needFallback.length > 0) {
    const { data: firsts } = await supabase.rpc("first_image_per_event", {
      p_event_ids: needFallback,
    });
    for (const row of firsts ?? []) {
      if (!coverKeyByEvent.has(row.event_id)) {
        coverKeyByEvent.set(row.event_id, row.r2_key);
        if (row.focal_x != null && row.focal_y != null) {
          focalByEvent.set(row.event_id, { x: row.focal_x, y: row.focal_y });
        }
      }
    }
  }

  // 3. Active shares for all events, one query. Preference: newest "full"
  //    share, else newest of any type (matches the old per-event logic).
  const shareSlugByEvent = new Map<string, string>();
  const fullLocked = new Set<string>();
  const { data: shares } = await supabase
    .from("shares")
    .select("event_id, slug, share_type, image_ids, created_at")
    .in("event_id", eventIds)
    .eq("is_active", true)
    .order("created_at", { ascending: false }); // newest first
  for (const s of shares ?? []) {
    if (fullLocked.has(s.event_id)) continue;
    // The any-type fallback must not offer a share the guest routes refuse to
    // serve — that would be a dashboard link straight to a 404.
    if (resolveShareImageScope(s).kind === "none") continue;
    if (s.share_type === "full") {
      shareSlugByEvent.set(s.event_id, s.slug);
      fullLocked.add(s.event_id);
    } else if (!shareSlugByEvent.has(s.event_id)) {
      shareSlugByEvent.set(s.event_id, s.slug);
    }
  }

  // Presign covers in parallel (no DB round-trips).
  await Promise.all(
    events.map(async (event) => {
      const key = coverKeyByEvent.get(event.id);
      const isRaster = rasterEvents.has(event.id);
      result.set(event.id, {
        coverThumbnailUrl: key
          ? await getPresignedDownloadUrl(
              isRaster ? key : getThumbnailKey(key),
              14400
            )
          : null,
        // A raster is composed to frame — anchoring it would re-crop it.
        coverFocal: isRaster ? null : (focalByEvent.get(event.id) ?? null),
        activeShareSlug: shareSlugByEvent.get(event.id) ?? null,
      });
    })
  );

  return result;
}
