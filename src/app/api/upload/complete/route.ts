import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import {
  createServiceClient,
  type AppSupabaseClient,
} from "@/lib/supabase/server";

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded to R2.
 * Updates EXIF data, generates thumbnails, and marks image as "complete".
 * AI processing is triggered separately when Inngest is configured.
 *
 * Auth: requires a signed-in user. The image's parent event must belong to
 * that user — RLS on the `images` UPDATE enforces this through the
 * event_id → events.user_id chain. Without auth this route was an
 * unauthenticated EXIF-rewrite primitive over arbitrary imageIds.
 */
export async function POST(request: NextRequest) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

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

    if (!imageId || typeof imageId !== "string") {
      return NextResponse.json(
        { error: "imageId is required" },
        { status: 400 }
      );
    }

    // Update image with EXIF data and mark as complete.
    // The RLS-bound client only matches images whose parent event the caller
    // owns — non-owned imageIds silently update zero rows.
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

    const { data: updated, error: updateError } = await supabase
      .from("images")
      .update(updateData)
      .eq("id", imageId)
      .select("id, event_id, r2_key")
      .single();

    if (updateError || !updated) {
      // Either the image doesn't exist or it doesn't belong to this user
      // (RLS filtered the UPDATE to zero rows). Don't distinguish — both
      // are 404 from the caller's perspective.
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404 }
      );
    }

    // Generate thumbnails in the background (fire-and-forget).
    // Uses the service client because the request cookies may be released
    // once we respond; thumbnails are an internal/service operation anyway.
    generateThumbnailsForImage(updated.id);

    // Trigger AI pipeline only if Inngest is configured
    if (process.env.INNGEST_EVENT_KEY) {
      try {
        const { inngest } = await import("@/lib/inngest/client");
        await inngest.send({
          name: "image/uploaded",
          data: {
            imageId: updated.id,
            eventId: updated.event_id,
            r2Key: updated.r2_key,
          },
        });
      } catch (err) {
        // Don't fail the request, but log loudly so the failure isn't silent.
        console.error(
          `[upload/complete] inngest.send failed for image ${updated.id}:`,
          err
        );
      }
    }

    return NextResponse.json({ success: true, imageId: updated.id });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}

/** Fire-and-forget thumbnail generation for a single image. */
async function generateThumbnailsForImage(imageId: string) {
  const supabase: AppSupabaseClient = createServiceClient();
  try {
    const { data: image } = await supabase
      .from("images")
      .select("r2_key, event_id, filename")
      .eq("id", imageId)
      .single();

    if (!image?.r2_key || !image?.event_id || !image?.filename) return;

    const { generateThumbnails } = await import("@/lib/thumbnails/generate");
    await generateThumbnails(image.r2_key, image.event_id, image.filename);

    // Mark thumbnail as generated so batch backfill skips this image
    await supabase
      .from("images")
      .update({ thumbnail_generated: true })
      .eq("id", imageId);

  } catch (err) {
    // Non-critical — grid will fall back to original URL
    console.error(`Thumbnail generation failed for ${imageId}:`, err);
  }
}
