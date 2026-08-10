import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { normalizeCoverSettings, coverNeedsRaster } from "@/types/event-settings";
import { resolveCoverRasterUrl, fetchMosaicPool, poolLeads } from "@/lib/cover/pool";
import { resolveShareImageScope, shareScopeIdFilter } from "@/lib/gallery/share-scope";

/**
 * GET /api/gallery/[slug]/cover
 *
 * Stable, non-expiring URL for a gallery's cover image — built for email.
 * Presigned R2 URLs live hours; emails get opened days later. This route is
 * the durable address: each hit 302s to a fresh presigned thumbnail.
 *
 * Access control matches the email's own gallery link: the slug IS the
 * credential. The redirect dies with the share (deactivated/expired → 404/410),
 * and it serves only the single designated cover image — never the grid. The
 * password gate is intentionally NOT enforced here: the cover is the hero of
 * an email the photographer chose to send.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = createServiceClient();

    const { data: share } = await supabase
      .from("shares")
      .select("event_id, expires_at, share_type, image_ids")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }

    const scope = resolveShareImageScope(share);
    if (scope.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("settings")
      .eq("id", share.event_id)
      .single();

    const settings = (event?.settings ?? {}) as Record<string, unknown>;
    const cover = normalizeCoverSettings(settings.cover);

    // Selection shares expose only their hand-picked image_ids — the raster
    // (composed from the whole source section) and any unselected fallback
    // must never leak photos the curation deliberately excluded. `null` here
    // means an unrestricted (full) share, never "unknown type".
    const selectedIds = shareScopeIdFilter(scope);

    // Mosaic/solid covers serve the composed raster (stale-while-revalidate;
    // resolveCoverRasterUrl enqueues a refresh when inputs drifted). Falls
    // through to the single-image chain when no raster exists yet.
    if (!selectedIds && coverNeedsRaster(cover)) {
      const rasterUrl = await resolveCoverRasterUrl(share.event_id, cover, 3600);
      if (rasterUrl) {
        return NextResponse.redirect(rasterUrl, {
          status: 302,
          headers: { "Cache-Control": "public, max-age=900" },
        });
      }
    }

    // Single-image chain: the designated cover image; else (crossfade, or a
    // mosaic whose raster hasn't composed yet) the source pool's lead shot.
    let r2Key: string | null = null;
    if (cover.imageId && (!selectedIds || selectedIds.has(cover.imageId))) {
      const { data: image } = await supabase
        .from("images")
        .select("r2_key")
        .eq("id", cover.imageId)
        .eq("event_id", share.event_id)
        .single();
      r2Key = image?.r2_key ?? null;
    }
    if (!r2Key && cover.type !== "image") {
      const sectionId =
        cover.type === "crossfade"
          ? cover.crossfade?.sectionId
          : cover.mosaic?.sectionId;
      const leads = poolLeads(await fetchMosaicPool(share.event_id, sectionId));
      r2Key =
        leads.find((l) => !selectedIds || selectedIds.has(l.id))?.r2_key ?? null;
    }
    if (!r2Key) {
      return NextResponse.json({ error: "No cover image" }, { status: 404 });
    }

    // 800px JPEG thumbnail — right size for a 560px-wide email card.
    const url = await getPresignedDownloadUrl(getThumbnailKey(r2Key, "thumb-lg"), 3600);

    return NextResponse.redirect(url, {
      status: 302,
      // Cacheable briefly so email-client image proxies don't hammer us, but
      // well under the presign's 1h validity.
      headers: { "Cache-Control": "public, max-age=900" },
    });
  } catch (error) {
    console.error("Gallery cover error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
