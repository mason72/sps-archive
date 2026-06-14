import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifySharedSecret } from "@/lib/sps-integration/auth";
import { isValidScene, sceneForKey, deriveServiceFromScene } from "@/lib/site/scenes";
import {
  SITE_ASSET_COLUMNS,
  serializeSiteAsset,
  type SiteAssetRow,
} from "@/lib/site/serialize";
import { uploadToR2, buildImageKey } from "@/lib/r2/client";
import { generateThumbnailsFromBuffer } from "@/lib/thumbnails/generate";
import { syncSitePublication } from "@/lib/site/membership";

// The POST path runs sharp (thumbnails) — Node runtime, with headroom for the
// R2 round-trips and publish copy.
export const runtime = "nodejs";
export const maxDuration = 60;

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

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Pull mime + bytes from a data URL or raw base64 (+ a mime hint). */
function decodeImage(
  imageBase64: string,
  mimeHint?: string
): { buffer: Buffer; mimeType: string; ext: string } | null {
  let mimeType = mimeHint || "image/jpeg";
  let data = imageBase64;
  const dataUrl = imageBase64.match(/^data:([^;]+);base64,([\s\S]*)$/);
  if (dataUrl) {
    mimeType = dataUrl[1];
    data = dataUrl[2];
  }
  const ext = EXT_BY_MIME[mimeType.toLowerCase()];
  if (!ext) return null; // only browser-renderable stills
  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0) return null;
  return { buffer, mimeType, ext };
}

/**
 * POST /api/site/scene/[...key]
 *
 * Site-facing WRITE: push a ready-to-publish image straight into a scene from
 * the marketing site (the AI sandbox). Same shared-secret auth as GET. The
 * image arrives as base64 (data URL or raw + `mimeType`); we store the
 * original, generate thumbnails synchronously (so it's instantly eligible),
 * create the `images` row, bind it to the scene's section, and publish.
 *
 * For ordered/slot scenes a `position` (1-based) REPLACES whatever sits at
 * that slot — "pop the Color sample into slot 4" overwrites slot 4. For pool
 * scenes the image is appended. The displaced image's row is left intact but
 * unpublished (membership removed), mirroring "remove from website".
 *
 * Body: { imageBase64, mimeType?, filename?, position?, focalX?, focalY? }
 * Returns: { imageId, scene, position, url }
 */
export async function POST(
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
    const scene = sceneForKey(sceneKey);
    if (!isValidScene(sceneKey) || !scene) {
      return NextResponse.json({ error: `Unknown scene: ${sceneKey}` }, { status: 404 });
    }

    const body = (await request.json().catch(() => null)) as {
      imageBase64?: string;
      mimeType?: string;
      filename?: string;
      position?: number;
      focalX?: number;
      focalY?: number;
    } | null;
    if (!body?.imageBase64) {
      return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
    }

    const decoded = decodeImage(body.imageBase64, body.mimeType);
    if (!decoded) {
      return NextResponse.json(
        { error: "Unsupported or empty image (need jpeg/png/webp)." },
        { status: 400 }
      );
    }
    const { buffer, mimeType, ext } = decoded;

    const supabase = createServiceClient();

    // The section backing this scene must already exist (scaffolded when the
    // team first curated it). We read event_id straight off it — no user.
    const { data: section, error: sectionError } = await supabase
      .from("sections")
      .select("id, event_id, locked")
      .eq("site_scene_key", sceneKey)
      .maybeSingle();
    if (sectionError) {
      console.error("Site scene POST section lookup error:", sectionError);
      return NextResponse.json({ error: "Failed to resolve scene" }, { status: 500 });
    }
    if (!section) {
      return NextResponse.json(
        { error: `Scene "${sceneKey}" has no section yet — add one image via the dashboard first.` },
        { status: 409 }
      );
    }
    if (section.locked) {
      return NextResponse.json(
        { error: `Scene "${sceneKey}" is locked — unlock it to publish here.` },
        { status: 423 }
      );
    }
    const eventId = section.event_id;

    // Positioned scenes replace a slot; pools append.
    const positioned = scene.kind === "ordered" || scene.kind === "slot";
    let sortOrder: number;
    let displaced: string[] = [];
    if (positioned) {
      const position = body.position && body.position > 0 ? Math.floor(body.position) : 1;
      sortOrder = position - 1;
      const { data: existing } = await supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", section.id)
        .eq("sort_order", sortOrder);
      displaced = (existing ?? []).map((r) => r.image_id);
    } else {
      const { data: maxSort } = await supabase
        .from("section_images")
        .select("sort_order")
        .eq("section_id", section.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      sortOrder = (maxSort?.sort_order ?? -1) + 1;
    }

    // Store original + thumbnails (sync, so it's publish-eligible immediately).
    const id = randomUUID();
    const filename = `${id}.${ext}`;
    const r2Key = buildImageKey(eventId, filename);
    await uploadToR2(r2Key, buffer, mimeType);

    let width: number | null = null;
    let height: number | null = null;
    try {
      const thumbs = await generateThumbnailsFromBuffer(buffer, eventId, filename);
      width = thumbs.width;
      height = thumbs.height;
    } catch (thumbErr) {
      console.error("Site scene POST thumbnail error:", thumbErr);
      return NextResponse.json(
        { error: "Could not process the image (thumbnailing failed)." },
        { status: 502 }
      );
    }

    const focalValid = (n?: number) => typeof n === "number" && n >= 0 && n <= 100;
    const { error: insertError } = await supabase.from("images").insert({
      id,
      event_id: eventId,
      filename,
      original_filename: body.filename || filename,
      r2_key: r2Key,
      file_size: buffer.length,
      mime_type: mimeType,
      media_type: "image",
      processing_status: "complete",
      thumbnail_generated: true,
      width,
      height,
      focal_x: focalValid(body.focalX) ? body.focalX : null,
      focal_y: focalValid(body.focalY) ? body.focalY : null,
    });
    if (insertError) {
      console.error("Site scene POST image insert error:", insertError);
      return NextResponse.json({ error: "Failed to record image" }, { status: 500 });
    }

    // Swap membership: drop the displaced slot occupant(s), bind the new image
    // at the target sort order.
    if (displaced.length > 0) {
      await supabase
        .from("section_images")
        .delete()
        .eq("section_id", section.id)
        .in("image_id", displaced);
    }
    const { error: linkError } = await supabase
      .from("section_images")
      .upsert(
        { section_id: section.id, image_id: id, sort_order: sortOrder },
        { onConflict: "section_id,image_id" }
      );
    if (linkError) {
      // Roll back the orphaned image row so we don't leak a private asset.
      await supabase.from("images").delete().eq("id", id);
      console.error("Site scene POST link error:", linkError);
      return NextResponse.json({ error: "Failed to place image in scene" }, { status: 500 });
    }

    // Publish the new image; re-sync the displaced ones so they unpublish now
    // that they're no longer in any website section.
    const sync = await syncSitePublication(supabase, [id, ...displaced]);
    if (!sync.published.includes(id)) {
      return NextResponse.json(
        { error: "Image stored but failed to publish to the public lane." },
        { status: 502 }
      );
    }

    // Hand back the real public-lane URL the site will serve (not the private
    // original), via the same serializer the GET path uses.
    const { data: published } = await supabase
      .from("images")
      .select(SITE_ASSET_COLUMNS)
      .eq("id", id)
      .maybeSingle();
    const asset = published
      ? serializeSiteAsset(published as unknown as SiteAssetRow, deriveServiceFromScene(sceneKey))
      : null;

    return NextResponse.json({
      imageId: id,
      scene: sceneKey,
      position: positioned ? sortOrder + 1 : null,
      replaced: displaced.length,
      url: asset?.fullUrl ?? null,
      thumbUrl: asset?.thumbUrl ?? null,
    });
  } catch (err) {
    console.error("Site scene POST error:", err);
    return NextResponse.json({ error: "Failed to publish image" }, { status: 500 });
  }
}
