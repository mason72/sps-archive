import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded to R2.
 * Updates EXIF data, generates thumbnails, and marks image as "complete".
 * AI processing is triggered separately when Inngest is configured.
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

    const { error: updateError } = await supabase
      .from("images")
      .update(updateData)
      .eq("id", imageId);

    if (updateError) throw updateError;

    // Generate thumbnails in the background (fire-and-forget)
    // This downloads the original from R2, resizes with sharp, and re-uploads
    generateThumbnailsForImage(supabase, imageId);

    // Trigger AI pipeline only if Inngest is configured
    if (process.env.INNGEST_EVENT_KEY) {
      try {
        const { inngest } = await import("@/lib/inngest/client");
        const { data: image } = await supabase
          .from("images")
          .select("r2_key, event_id")
          .eq("id", imageId)
          .single();

        if (image) {
          await inngest.send({
            name: "image/uploaded",
            data: {
              imageId,
              eventId: image.event_id,
              r2Key: image.r2_key,
            },
          });
        }
      } catch {
        // Inngest not available — skip AI processing silently
      }
    }

    return NextResponse.json({ success: true, imageId });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}

/** Fire-and-forget thumbnail generation for a single image */
async function generateThumbnailsForImage(
  supabase: ReturnType<typeof createServiceClient>,
  imageId: string
) {
  try {
    const { data: image } = await supabase
      .from("images")
      .select("r2_key, event_id, filename")
      .eq("id", imageId)
      .single();

    if (!image?.r2_key || !image?.event_id || !image?.filename) return;

    const { generateThumbnails } = await import("@/lib/thumbnails/generate");
    await generateThumbnails(image.r2_key, image.event_id, image.filename);

    console.log(`Thumbnails generated for ${imageId}`);
  } catch (err) {
    // Non-critical — grid will fall back to original URL
    console.error(`Thumbnail generation failed for ${imageId}:`, err);
  }
}
