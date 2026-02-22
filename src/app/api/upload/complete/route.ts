import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/upload/complete
 *
 * Called after a file has been uploaded directly to R2.
 * Updates EXIF data and triggers AI processing.
 *
 * Request body:
 * {
 *   imageId: string,
 *   width?: number,
 *   height?: number,
 *   exif?: { takenAt, cameraMake, cameraModel, lens, ... }
 * }
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

    // Update image with EXIF data and dimensions
    const updateData: Record<string, unknown> = {
      processing_status: "processing",
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

    // TODO: Trigger Inngest event for AI processing
    // await inngest.send({
    //   name: "image/uploaded",
    //   data: { imageId },
    // });

    return NextResponse.json({ success: true, imageId });
  } catch (error) {
    console.error("Upload complete error:", error);
    return NextResponse.json(
      { error: "Failed to complete upload" },
      { status: 500 }
    );
  }
}
