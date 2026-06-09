import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifySharedSecret } from "@/lib/sps-integration/auth";
import { isValidScene } from "@/lib/site/scenes";
import { getPublicLaneUrl } from "@/lib/r2/public-lane";
import { publicLaneKeys } from "@/lib/site/publish";

/**
 * GET /api/site/scene/[...key]
 *
 * Site-facing endpoint for the Two Dudes Photo marketing website. Returns the
 * images the team has curated into a website scene, with PUBLIC, non-expiring
 * URLs (served from the sps-public bucket over the public custom domain). The
 * site rotates/selects from this set on its own.
 *
 * Catch-all segment so namespaced keys work: /api/site/scene/service/photo-booth
 * → "service/photo-booth"; /api/site/scene/hero → "hero".
 *
 * Auth: shared secret header `X-SPS-Key: <SPS_INTEGRATION_KEY>`.
 *
 * NO presigning here — these URLs are meant to be cached and embedded publicly.
 * Only images explicitly tagged into a scene are ever returned, so private
 * client-gallery photos are never exposed.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  try {
    if (!verifySharedSecret(request)) {
      return NextResponse.json(
        { error: "Unauthorized. Provide X-SPS-Key header." },
        { status: 401 }
      );
    }

    const { key } = await params;
    const sceneKey = (key || []).join("/");

    if (!isValidScene(sceneKey)) {
      return NextResponse.json(
        { error: `Unknown scene: ${sceneKey}` },
        { status: 404 }
      );
    }

    const supabase = createServiceClient();

    // Curated, displayable images for this scene. Featured first, then the
    // team's manual display_order, then newest-first as a stable tiebreak.
    const { data: rows, error } = await supabase
      .from("images")
      .select(
        "id, r2_key, width, height, service, featured, events!event_id(name, city)"
      )
      .eq("site_scene", sceneKey)
      .eq("thumbnail_generated", true)
      .order("featured", { ascending: false })
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Site scene query error:", error);
      return NextResponse.json({ error: "Failed to load scene" }, { status: 500 });
    }

    const images = (rows || []).map((img) => {
      const event = (img.events ?? {}) as { name?: string | null; city?: string | null };
      const { thumbKey, displayKey } = publicLaneKeys(img.r2_key);
      return {
        id: img.id,
        event: event.name ?? null,
        city: event.city ?? null,
        service: img.service ?? null,
        featured: img.featured ?? false,
        width: img.width,
        height: img.height,
        thumbUrl: getPublicLaneUrl(thumbKey),
        fullUrl: getPublicLaneUrl(displayKey),
      };
    });

    return NextResponse.json(
      { scene: sceneKey, count: images.length, images },
      // Public, cacheable response — the site can cache and revalidate.
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
    );
  } catch (err) {
    console.error("Site scene error:", err);
    return NextResponse.json({ error: "Failed to load scene" }, { status: 500 });
  }
}
