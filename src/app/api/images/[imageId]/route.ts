import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";

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

    // Generate presigned URLs — thumb (4h), original (4h), download (1h)
    const thumbKey = getThumbnailKey(image.r2_key);
    const [thumbnailUrl, originalUrl, downloadUrl] = await Promise.all([
      getPresignedDownloadUrl(thumbKey, 14400),
      getPresignedDownloadUrl(image.r2_key, 14400),
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
    });
  } catch (error) {
    console.error("Get image detail error:", error);
    return NextResponse.json(
      { error: "Failed to load image" },
      { status: 500 }
    );
  }
}
