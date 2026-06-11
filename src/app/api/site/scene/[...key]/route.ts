import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifySharedSecret } from "@/lib/sps-integration/auth";
import { isValidScene, sceneForKey, deriveServiceFromScene } from "@/lib/site/scenes";
import {
  SITE_ASSET_COLUMNS,
  serializeSiteAsset,
  type SiteAssetRow,
} from "@/lib/site/serialize";

/**
 * GET /api/site/scene/[...key]
 *
 * Site-facing endpoint for the Two Dudes Photo marketing website. Returns the
 * images curated into a website scene, with PUBLIC, non-expiring URLs (served
 * from the sps-public bucket over the public custom domain).
 *
 * v2: a scene is a SECTION of the "TDP Website" gallery (matched on
 * sections.site_scene_key) — membership is publication. Pool scenes return the
 * whole set (featured first, then the section's drag order, then newest); the
 * site rotates/selects on its own. Slot scenes (slot/*) are explicit
 * single-image positions: the first image by drag order wins and is the only
 * one returned — except rotating slots (SceneDef.rotates, the service-page
 * hero carousels), which return the full set in exact drag order.
 * The response contract is unchanged from v1, plus focalX/focalY
 * (0-100 percentages or null) which the site maps to CSS object-position.
 *
 * Catch-all segment so namespaced keys work: /api/site/scene/service/photo-booth
 * → "service/photo-booth"; /api/site/scene/hero → "hero".
 *
 * Auth: shared secret header `X-SPS-Key: <SPS_INTEGRATION_KEY>`.
 *
 * NO presigning here — these URLs are meant to be cached and embedded publicly.
 * Only images published into a website section are ever returned (the
 * site_published_at gate also keeps an image whose R2 copy failed from being
 * served as a broken URL), so private client-gallery photos are never exposed.
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

    // The website-gallery section backing this scene. A known key whose
    // section hasn't been scaffolded yet is just an empty scene, not a 404.
    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .select("id")
      .eq("site_scene_key", sceneKey)
      .maybeSingle();

    if (sectionError) {
      console.error("Site scene section lookup error:", sectionError);
      return NextResponse.json({ error: "Failed to load scene" }, { status: 500 });
    }

    type SceneRow = {
      sort_order: number;
      images: SiteAssetRow;
    };

    let rows: SceneRow[] = [];
    if (section) {
      const { data, error } = await supabase
        .from("section_images")
        .select(`sort_order, images!inner(${SITE_ASSET_COLUMNS})`)
        .eq("section_id", section.id)
        .eq("images.thumbnail_generated", true)
        .not("images.site_published_at", "is", null);

      if (error) {
        console.error("Site scene query error:", error);
        return NextResponse.json({ error: "Failed to load scene" }, { status: 500 });
      }
      rows = (data ?? []) as unknown as SceneRow[];
    }

    // Pool: featured first, then the team's drag order, then newest-first as
    // a stable tiebreak. Ordered (position-mapped) + slot: exact drag order —
    // a featured boost would scramble positions. Slot additionally returns
    // only the winner, unless the scene rotates (service-page hero carousels
    // cycle through the full set in drag order). (Curated sets are small, so
    // sorting here beats a PostgREST order-by-embedded-column dependency.)
    const scene = sceneForKey(sceneKey);
    const kind = scene?.kind ?? "pool";
    rows.sort((a, b) => {
      if (kind === "pool" && a.images.featured !== b.images.featured) {
        return a.images.featured ? -1 : 1;
      }
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return b.images.created_at.localeCompare(a.images.created_at);
    });
    if (kind === "slot" && !scene?.rotates) rows = rows.slice(0, 1);

    // Serialized via the shared site-asset shape: the image contract is
    // unchanged, and videos add kind/duration/posterUrl/videoUrl.
    const sceneService = deriveServiceFromScene(sceneKey);
    const images = rows.map(({ images: img }) =>
      serializeSiteAsset(img, sceneService)
    );

    return NextResponse.json(
      { scene: sceneKey, count: images.length, images },
      // `private` is load-bearing: with `public, s-maxage`, Vercel's edge cache
      // (which ignores X-SPS-Key in its cache key) served the authenticated
      // site's 200 to unauthenticated requests, bypassing the 401 above. The
      // authenticated consumer may cache locally; shared caches must not store.
      { headers: { "Cache-Control": "private, max-age=300" } }
    );
  } catch (err) {
    console.error("Site scene error:", err);
    return NextResponse.json({ error: "Failed to load scene" }, { status: 500 });
  }
}
