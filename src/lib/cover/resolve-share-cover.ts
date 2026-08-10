import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { normalizeCoverSettings, coverNeedsRaster } from "@/types/event-settings";
import { resolveCoverRasterUrl, fetchMosaicPool, poolLeads } from "@/lib/cover/pool";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";

/**
 * The one place that answers "what image does this share's cover show?".
 *
 * Two callers, and they MUST agree: the durable email-hero redirect
 * (`GET /api/gallery/[slug]/cover`) serves this, and the email composer
 * (`POST /api/emails/send`) decides whether to embed a hero <img> at all by
 * asking whether this returns anything. They used to answer separately —
 * the composer attached a hero whenever `cover.imageId` was set, the route
 * refused to serve one outside a selection share's scope — and every
 * selection share whose event cover sat outside the selection mailed a
 * broken image. A composer that predicts the route's answer will drift from
 * it; a composer that calls the route's own resolver cannot.
 *
 * Scope rule: a selection share exposes ONLY its hand-picked image_ids. The
 * whole-section raster and any unselected fallback would leak frames the
 * curation deliberately excluded, so both are filtered against the picks.
 */

export interface ShareCoverRef {
  event_id: string;
  share_type: string;
  image_ids: string[] | null;
}

/**
 * Presigned URL for the share's cover, or null when it genuinely has none.
 *
 * Resolution order, all of it scope-filtered:
 *  1. the composed mosaic/solid raster (full shares only — it is built from
 *     the whole source section, so it can never be selection-safe);
 *  2. the event's designated cover image, when it's in scope;
 *  3. the lead shot of the share's own pool.
 *
 * Step 3 is what makes the durable URL actually durable. It used to be gated
 * on `cover.type !== "image"`, so an image-type cover that fell out of scope
 * — or was simply deleted — dead-ended at 404 forever. Now the address
 * self-heals to the next best frame the share is allowed to show.
 *
 * Note for the composer: for mosaic/solid covers this may enqueue a raster
 * refresh (stale-while-revalidate, inherited from resolveCoverRasterUrl).
 * At send time that's a feature — it warms the raster before recipients open.
 */
export async function resolveShareCoverUrl(
  share: ShareCoverRef,
  expiresIn = 3600
): Promise<string | null> {
  const supabase = createServiceClient();

  // Scope through the ONE shared resolver (share-scope.ts): unknown share
  // types and empty selections yield `none` → no cover at all, fail closed.
  // (The first draft hand-rolled `share_type === "selection"` here, which
  // reads as a selection special-case and MEANS "every other type gets the
  // whole event" — lesson 55's exact fail-open, re-created in a new file.)
  const shareScope = resolveShareImageScope(share);
  if (shareScope.kind === "none") return null;
  const scopeIds = shareScope.kind === "images" ? shareScope.imageIds : null;
  const scope = scopeIds ? new Set(scopeIds) : null;

  const { data: event } = await supabase
    .from("events")
    .select("settings")
    .eq("id", share.event_id)
    .single();

  const settings = (event?.settings ?? {}) as Record<string, unknown>;
  const cover = normalizeCoverSettings(settings.cover);

  if (!scope && coverNeedsRaster(cover)) {
    const rasterUrl = await resolveCoverRasterUrl(share.event_id, cover, expiresIn);
    if (rasterUrl) return rasterUrl;
  }

  let r2Key: string | null = null;

  if (cover.imageId && (!scope || scope.has(cover.imageId))) {
    const { data: image } = await supabase
      .from("images")
      .select("r2_key")
      .eq("id", cover.imageId)
      .eq("event_id", share.event_id)
      .single();
    r2Key = image?.r2_key ?? null;
  }

  if (!r2Key) {
    // Scope the pool BEFORE picking leads, not after. `poolLeads` collapses
    // filename-derived stacks to one frame each, and a stack's lead is not
    // necessarily the frame a selection picked — filtering the leads would
    // discard a stack whose selected member was never a lead.
    const sectionId =
      cover.type === "crossfade"
        ? cover.crossfade?.sectionId
        : cover.type === "mosaic"
          ? cover.mosaic?.sectionId
          : undefined;
    const pool = await fetchMosaicPool(share.event_id, sectionId);
    const scoped = scope ? pool.filter((t) => scope.has(t.id)) : pool;
    r2Key = poolLeads(scoped)[0]?.r2_key ?? null;
  }

  if (!r2Key) {
    // Last resort, and load-bearing for selection shares: fetchMosaicPool
    // returns the FIRST section with members, not the union of sections. A
    // selection whose picks all live in a later section filters that pool to
    // empty — which is precisely how three live shares still 404'd after the
    // pool fallback went in. Ask the images table directly.
    let q = supabase
      .from("images")
      .select("id, r2_key")
      .eq("event_id", share.event_id)
      .eq("thumbnail_generated", true);
    if (scopeIds) q = q.in("id", scopeIds);
    const { data: rows, error } = await q
      .order("created_at", { ascending: true })
      .limit(scopeIds ? scopeIds.length : 1);
    if (error) return null;
    // Honour curation order for a selection — image_ids is the photographer's
    // sequence, and its first frame is the one they'd call the lead.
    r2Key = scopeIds
      ? (scopeIds
          .map((id) => rows?.find((r) => r.id === id))
          .find(Boolean)?.r2_key ?? null)
      : (rows?.[0]?.r2_key ?? null);
  }

  if (!r2Key) return null;

  // 800px JPEG thumbnail — right size for a 560px-wide email card.
  return getPresignedDownloadUrl(getThumbnailKey(r2Key, "thumb-lg"), expiresIn);
}
