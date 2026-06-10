import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey, getDisplayKey } from "@/lib/r2/client";

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
    const [thumbnailUrl, originalUrl, downloadUrl] = await Promise.all([
      getPresignedDownloadUrl(thumbKey, 14400),
      getPresignedDownloadUrl(getDisplayKey(image.r2_key), 14400),
      getPresignedDownloadUrl(image.r2_key, 3600),
    ]);

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
 * Update per-image curation fields. Currently: the focal point ({focalX,
 * focalY}, 0–100 percentages or null to clear) used by website slot scenes —
 * the site maps it to CSS object-position so crops keep the subject.
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
    };

    if (!("focalX" in body) && !("focalY" in body)) {
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

    const updates: Record<string, number | null> = {};
    if ("focalX" in body) updates.focal_x = body.focalX ?? null;
    if ("focalY" in body) updates.focal_y = body.focalY ?? null;

    const { data, error } = await supabase
      .from("images")
      .update(updates)
      .eq("id", imageId)
      .select("id, focal_x, focal_y")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      id: data.id,
      focalX: data.focal_x,
      focalY: data.focal_y,
    });
  } catch (error) {
    console.error("Update image error:", error);
    return NextResponse.json(
      { error: "Failed to update image" },
      { status: 500 }
    );
  }
}
