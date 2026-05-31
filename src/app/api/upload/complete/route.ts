import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded to R2. Records EXIF/dimensions and
 * marks the image "complete" — fast, so uploads never wait on processing.
 *
 * Thumbnail generation is DEFERRED, not run here: it's slow, competes with
 * the upload path, and is unreliable on serverless (the function can freeze
 * after the response). The grid falls back to the original image until a
 * thumbnail exists, and /api/admin/batch-thumbnails backfills them out of
 * band. Uploading must never be blocked by processing.
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

    // NOTE: thumbnail generation intentionally NOT run here — deferred to the
    // out-of-band /api/admin/batch-thumbnails backfill so uploads stay fast
    // and never hang. The grid shows the original until a thumbnail exists.

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
