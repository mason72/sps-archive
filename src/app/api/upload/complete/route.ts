import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { generateThumbnails } from "@/lib/thumbnails/generate";

// Large originals (>4MB direct uploads) are downloaded here for thumbnailing;
// give sharp room and a node runtime.
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded to R2. Records EXIF/dimensions, ensures
 * a thumbnail exists, and marks the image "complete".
 *
 * Two upload paths converge here:
 *  - Proxy uploads (≤4MB) already generated thumbnails inline in
 *    /api/upload/[imageId], so thumbnail_generated is already true and we skip
 *    the work below.
 *  - Direct uploads (>4MB, browser→R2) never touched the server, so no
 *    thumbnail exists yet. We generate it here from the R2 original (download +
 *    sharp). Since display now gates on thumbnail_generated, a direct upload
 *    would otherwise be invisible in the gallery.
 *
 * Thumbnail generation here is best-effort: if it fails the original is safe,
 * the editor grid self-heals on view (/api/images/[id]/regenerate-thumbnail),
 * and /api/admin/batch-thumbnails backfills out of band.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { imageId, width, height, exif } = body as {
      imageId: string;
      width?: number;
      height?: number;
      exif?: {
        takenAt?: string;
        cameraMake?: string;
        cameraModel?: string;
        lens?: string;
        focalLength?: number;
        aperture?: number;
        shutterSpeed?: string;
        iso?: number;
        gpsLat?: number;
        gpsLng?: number;
      };
    };

    if (!imageId) {
      return NextResponse.json(
        { error: "imageId is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Look up the row so we know whether a thumbnail already exists (proxy path)
    // or still needs generating (direct >4MB path), and where the original is.
    const { data: image, error: fetchError } = await supabase
      .from("images")
      .select("r2_key, event_id, filename, thumbnail_generated")
      .eq("id", imageId)
      .single();

    if (fetchError || !image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Update image with EXIF data and mark as complete
    const updateData: Record<string, unknown> = {
      processing_status: "complete",
    };

    if (width) updateData.width = width;
    if (height) updateData.height = height;

    if (exif) {
      if (exif.takenAt) updateData.taken_at = exif.takenAt;
      if (exif.cameraMake) updateData.camera_make = exif.cameraMake;
      if (exif.cameraModel) updateData.camera_model = exif.cameraModel;
      if (exif.lens) updateData.lens = exif.lens;
      if (exif.focalLength) updateData.focal_length = exif.focalLength;
      if (exif.aperture) updateData.aperture = exif.aperture;
      if (exif.shutterSpeed) updateData.shutter_speed = exif.shutterSpeed;
      if (exif.iso) updateData.iso = exif.iso;
      if (exif.gpsLat) updateData.gps_lat = exif.gpsLat;
      if (exif.gpsLng) updateData.gps_lng = exif.gpsLng;
    }

    // Direct (>4MB) uploads never hit the server, so they have no thumbnail yet.
    // Generate it here from the R2 original — display gates on thumbnail_generated,
    // so without this a large upload would be invisible in the gallery. Proxy
    // uploads (≤4MB) already set thumbnail_generated, so we skip them.
    // Best-effort: the original is safe regardless, and the grid self-heals.
    if (!image.thumbnail_generated && image.r2_key) {
      try {
        const result = await generateThumbnails(
          image.r2_key,
          image.event_id,
          image.filename
        );
        updateData.thumbnail_generated = true;
        // Backfill real pixel dimensions if the client didn't supply them.
        if (!width && result.width) updateData.width = result.width;
        if (!height && result.height) updateData.height = result.height;
      } catch (thumbErr) {
        console.error(`Thumbnail generation failed for ${imageId}:`, thumbErr);
      }
    }

    const { error: updateError } = await supabase
      .from("images")
      .update(updateData)
      .eq("id", imageId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, imageId });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}
