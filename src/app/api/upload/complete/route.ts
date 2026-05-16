import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import {
  createServiceClient,
  type AppSupabaseClient,
} from "@/lib/supabase/server";

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded to R2. Updates EXIF data, kicks off
 * thumbnail generation, and (optionally) triggers the AI pipeline.
 *
 * Auth: requires a signed-in user. The image's parent event must belong to
 * that user — RLS on the `images` UPDATE enforces this through the
 * event_id → events.user_id chain.
 *
 * Status transitions:
 *   - Before this call: `pending` (row created by /api/upload).
 *   - On success: `processing` (uploaded + EXIF in; waiting on thumbnails).
 *   - Once the thumbnail job finishes (success): `complete`.
 *   - On thumbnail failure: `failed` with `last_error` set.
 *
 * The previous behavior set `complete` immediately, which produced the
 * "5 photos processed!" toast firing while the grid was still blank for
 * 10–60 seconds — and any thumbnail failure was silently swallowed.
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

    // Move from `pending` → `processing` while writing EXIF metadata.
    // The thumbnail job (below) flips to `complete` on success, or
    // `failed` + last_error on failure — so the user only sees "ready"
    // when there's something ready to render.
    const updateData: Record<string, unknown> = {
      processing_status: "processing",
      // Clear any prior error from a previous failed attempt at this row.
      last_error: null,
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

    // The RLS-bound client only matches images whose parent event the
    // caller owns — non-owned imageIds silently update zero rows.
    const { data: updated, error: updateError } = await supabase
      .from("images")
      .update(updateData)
      .eq("id", imageId)
      .select("id, event_id, r2_key")
      .single();

    if (updateError || !updated) {
      return NextResponse.json(
        { error: "Image not found" },
        { status: 404 }
      );
    }

    // Fire-and-forget thumbnail generation. Uses the service client so it
    // can keep running after the request cookie context is released.
    generateThumbnailsForImage(updated.id);

    // Trigger AI pipeline only if Inngest is configured. Dispatch errors
    // are logged loudly — lesson #3.
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

/**
 * Fire-and-forget thumbnail generation.
 *
 * Manages the final transition out of `processing`:
 *   success → `complete` + thumbnail_generated=true
 *   failure → `failed` + last_error
 *
 * If Inngest is also handling AI for this image, it may write `complete`
 * again later — that's fine, last-writer-wins. The previous behavior was
 * to log + return on failure, leaving the row stuck in whatever state it
 * was in when the request returned.
 */
async function generateThumbnailsForImage(imageId: string) {
  const supabase: AppSupabaseClient = createServiceClient();
  try {
    const { data: image } = await supabase
      .from("images")
      .select("r2_key, event_id, filename")
      .eq("id", imageId)
      .single();

    if (!image?.r2_key || !image?.event_id || !image?.filename) {
      console.error(`[thumbnails] image ${imageId} missing required fields`);
      return;
    }

    const { generateThumbnails } = await import("@/lib/thumbnails/generate");
    await generateThumbnails(image.r2_key, image.event_id, image.filename);

    await supabase
      .from("images")
      .update({
        thumbnail_generated: true,
        processing_status: "complete",
      })
      .eq("id", imageId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Thumbnail generation failed for ${imageId}:`, err);
    // Surface the failure on the row so the user (and any admin health
    // check) can see what happened.
    await supabase
      .from("images")
      .update({
        processing_status: "failed",
        last_error: `thumbnails: ${message}`.slice(0, 500),
      })
      .eq("id", imageId);
  }
}
