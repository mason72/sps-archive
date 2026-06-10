import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey, getDisplayKey } from "@/lib/r2/client";
import { computeAutoFocal } from "@/lib/site/focal";
import { scheduleSiteRevalidate } from "@/lib/site/revalidate";
import { SITE_SERVICES } from "@/lib/site/scenes";

/**
 * GET /api/images/[imageId]
 *
 * Returns full image metadata including EXIF data, AI scores,
 * scene tags, and a presigned download URL. Used by the lightbox
 * for lazy-loading detailed metadata.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageId } = await params;

    const { data: image, error } = await supabase
      .from("images")
      .select("*")
      .eq("id", imageId)
      .single();

    if (error || !image) {
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404 }
      );
    }

    // Generate presigned URLs — thumb (4h), display (4h), download (1h).
    // "display" is the web-viewable URL the lightbox renders: the original for
    // JPEG/PNG/etc., or the 800px JPEG for non-renderable formats (TIFF).
    // Download always serves the raw original.
    const thumbKey = getThumbnailKey(image.r2_key);
    const [thumbnailUrl, originalUrl, downloadUrl, facesResult] =
      await Promise.all([
        getPresignedDownloadUrl(thumbKey, 14400),
        getPresignedDownloadUrl(getDisplayKey(image.r2_key), 14400),
        getPresignedDownloadUrl(image.r2_key, 3600),
        supabase
          .from("faces")
          .select("bbox_x, bbox_y, bbox_w, bbox_h, quality")
          .eq("image_id", imageId),
      ]);

    // Face-based focal suggestion (single confident subject, eye level) — the
    // focal point picker pre-places its marker here when none is set yet.
    const suggestedFocal = computeAutoFocal(facesResult.data ?? []);

    return NextResponse.json({
      id: image.id,
      r2Key: image.r2_key,
      thumbnailUrl,
      originalUrl,
      downloadUrl,
      originalFilename: image.original_filename,
      aestheticScore: image.aesthetic_score,
      sharpnessScore: image.sharpness_score,
      stackId: image.stack_id,
      stackRank: image.stack_rank,
      parsedName: image.parsed_name,
      processingStatus: image.processing_status,
      width: image.width,
      height: image.height,
      takenAt: image.taken_at,
      cameraMake: image.camera_make,
      cameraModel: image.camera_model,
      lens: image.lens,
      focalLength: image.focal_length,
      aperture: image.aperture,
      shutterSpeed: image.shutter_speed,
      iso: image.iso,
      gpsLat: image.gps_lat,
      gpsLng: image.gps_lng,
      sceneTags: image.scene_tags,
      isEyesOpen: image.is_eyes_open,
      focalX: image.focal_x,
      focalY: image.focal_y,
      service: image.service,
      featured: image.featured ?? false,
      suggestedFocalX: suggestedFocal?.x ?? null,
      suggestedFocalY: suggestedFocal?.y ?? null,
    });
  } catch (error) {
    console.error("Get image detail error:", error);
    return NextResponse.json(
      { error: "Failed to load image" },
      { status: 500 }
    );
  }
}

/** Is this a valid focal coordinate — a 0–100 percentage, or null to clear? */
function isValidFocal(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100);
}

/**
 * PATCH /api/images/[imageId]
 *
 * Update per-image website curation fields:
 *  - focalX/focalY — 0–100 percentages or null to clear; website slot scenes
 *    map them to CSS object-position so crops keep the subject
 *  - service — canonical service slug (scene registry) or null to clear;
 *    the site's caption/filter field
 *  - featured — pool scenes rank featured images first
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageId } = await params;
    const body = (await request.json()) as {
      focalX?: number | null;
      focalY?: number | null;
      service?: string | null;
      featured?: boolean;
    };

    const fields = ["focalX", "focalY", "service", "featured"] as const;
    if (!fields.some((f) => f in body)) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }
    if (
      ("focalX" in body && !isValidFocal(body.focalX)) ||
      ("focalY" in body && !isValidFocal(body.focalY))
    ) {
      return NextResponse.json(
        { error: "focalX/focalY must be 0-100 or null" },
        { status: 400 }
      );
    }
    if (
      "service" in body &&
      body.service !== null &&
      !SITE_SERVICES.includes(body.service as string)
    ) {
      return NextResponse.json(
        { error: `service must be one of ${SITE_SERVICES.join(", ")} or null` },
        { status: 400 }
      );
    }
    if ("featured" in body && typeof body.featured !== "boolean") {
      return NextResponse.json(
        { error: "featured must be a boolean" },
        { status: 400 }
      );
    }

    // Verify ownership through the event chain.
    const { data: image } = await supabase
      .from("images")
      .select("id, events!event_id(user_id)")
      .eq("id", imageId)
      .single();
    const owner = (image?.events as { user_id?: string } | null)?.user_id;
    if (!image || owner !== user!.id) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const updates: Record<string, number | string | boolean | null> = {};
    if ("focalX" in body) updates.focal_x = body.focalX ?? null;
    if ("focalY" in body) updates.focal_y = body.focalY ?? null;
    if ("service" in body) updates.service = body.service ?? null;
    if (typeof body.featured === "boolean") updates.featured = body.featured;

    const { data, error } = await supabase
      .from("images")
      .update(updates)
      .eq("id", imageId)
      .select("id, focal_x, focal_y, service, featured, site_published_at")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // All PATCHable fields here render on the marketing site — refresh its
    // cache, but only for published images (= in a website section).
    if (data.site_published_at) scheduleSiteRevalidate();

    return NextResponse.json({
      id: data.id,
      focalX: data.focal_x,
      focalY: data.focal_y,
      service: data.service,
      featured: data.featured,
    });
  } catch (error) {
    console.error("Update image error:", error);
    return NextResponse.json(
      { error: "Failed to update image" },
      { status: 500 }
    );
  }
}
