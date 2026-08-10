import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServiceClient>;

/** Minimal event shape the enrichment needs. */
export interface EnrichableEvent {
  id: string;
  settings: unknown;
  [key: string]: unknown;
}

export interface EventEnrichment {
  /** Presigned cover thumbnail URL (settings cover → earliest image fallback). */
  coverThumbnailUrl: string | null;
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

  // 1. Explicit cover images (settings.cover.imageId), one query.
  const coverImageIds = events
    .map((e) => {
      const settings = (e.settings ?? {}) as Record<string, unknown>;
      const cover = settings.cover as { imageId?: string } | undefined;
      return cover?.imageId;
    })
    .filter((id): id is string => !!id);

  const coverKeyById = new Map<string, string>();
  if (coverImageIds.length > 0) {
    const { data: coverImgs } = await supabase
      .from("images")
      .select("id, r2_key")
      .in("id", coverImageIds);
    for (const img of coverImgs ?? []) coverKeyById.set(img.id, img.r2_key);
  }
  for (const e of events) {
    const settings = (e.settings ?? {}) as Record<string, unknown>;
    const cover = settings.cover as { imageId?: string } | undefined;
    const key = cover?.imageId ? coverKeyById.get(cover.imageId) : undefined;
    if (key) coverKeyByEvent.set(e.id, key);
  }

  // 2. Fallback: earliest image per event (one round-trip) for the rest.
  const needFallback = eventIds.filter((id) => !coverKeyByEvent.has(id));
  if (needFallback.length > 0) {
    const { data: firsts } = await supabase.rpc("first_image_per_event", {
      p_event_ids: needFallback,
    });
    for (const row of firsts ?? []) {
      if (!coverKeyByEvent.has(row.event_id)) {
        coverKeyByEvent.set(row.event_id, row.r2_key);
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
      result.set(event.id, {
        coverThumbnailUrl: key
          ? await getPresignedDownloadUrl(getThumbnailKey(key), 14400)
          : null,
        activeShareSlug: shareSlugByEvent.get(event.id) ?? null,
      });
    })
  );

  return result;
}
