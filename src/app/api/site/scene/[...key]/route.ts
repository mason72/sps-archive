import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifySharedSecret } from "@/lib/sps-integration/auth";
import { isValidScene, sceneForKey, deriveServiceFromScene } from "@/lib/site/scenes";
import { getPublicLaneUrl } from "@/lib/r2/public-lane";
import { publicLaneKeys } from "@/lib/site/publish";

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
 * one returned. The response contract is unchanged from v1, plus focalX/focalY
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
      images: {
        id: string;
        r2_key: string;
        width: number | null;
        height: number | null;
        service: string | null;
        featured: boolean;
        created_at: string;
        focal_x: number | null;
        focal_y: number | null;
        events: { name: string | null; city: string | null } | null;
      };
    };

    let rows: SceneRow[] = [];
    if (section) {
      const { data, error } = await supabase
        .from("section_images")
        .select(
          "sort_order, images!inner(id, r2_key, width, height, service, featured, created_at, focal_x, focal_y, events!event_id(name, city))"
        )
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
    // only the winner. (Curated sets are small, so sorting here beats a
    // PostgREST order-by-embedded-column dependency.)
    const kind = sceneForKey(sceneKey)?.kind ?? "pool";
    rows.sort((a, b) => {
      if (kind === "pool" && a.images.featured !== b.images.featured) {
        return a.images.featured ? -1 : 1;
      }
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return b.images.created_at.localeCompare(a.images.created_at);
    });
    if (kind === "slot") rows = rows.slice(0, 1);

    const sceneService = deriveServiceFromScene(sceneKey);
    const images = rows.map(({ images: img }) => {
      const event = img.events ?? { name: null, city: null };
      const { thumbKey, displayKey } = publicLaneKeys(img.r2_key);
      return {
        id: img.id,
        event: event.name ?? null,
        city: event.city ?? null,
        service: img.service ?? sceneService,
        featured: img.featured ?? false,
        width: img.width,
        height: img.height,
        thumbUrl: getPublicLaneUrl(thumbKey),
        fullUrl: getPublicLaneUrl(displayKey),
        focalX: img.focal_x ?? null,
        focalY: img.focal_y ?? null,
      };
    });

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
