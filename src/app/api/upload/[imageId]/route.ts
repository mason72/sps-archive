import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { uploadToR2 } from "@/lib/r2/client";
import { generateThumbnailsFromBuffer } from "@/lib/thumbnails/generate";
import { syncSitePublication } from "@/lib/site/membership";

// Allow large file uploads (up to 100MB)
export const runtime = "nodejs";
export const maxDuration = 120; // 2 minutes

/**
 * PUT /api/upload/[imageId]
 *
 * Receives the raw file binary, stores the original in R2, and generates
 * thumbnails from the SAME in-memory buffer before responding. Doing it here
 * (awaited, with the bytes already in hand) is reliable — unlike the old
 * fire-and-forget job in /api/upload/complete, which froze after the response
 * on serverless and left images stuck "failed" with no thumbnail.
 *
 * This is also the path that avoids CORS for browser→R2 uploads ≤4MB.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageId } = await params;

    // Look up the image record to get the r2_key + filename.
    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("id, r2_key, mime_type, media_type, filename, event_id")
      .eq("id", imageId)
      .single();

    if (imageError || !image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Read the file body once; reuse the buffer for both R2 and thumbnails.
    const body = Buffer.from(await request.arrayBuffer());
    const contentType =
      request.headers.get("content-type") || image.mime_type || "image/jpeg";

    // 1. Store the original.
    await uploadToR2(image.r2_key, body, contentType);

    // 2. Generate thumbnails from the same buffer (awaited = reliable).
    //    Non-fatal: if thumbnailing fails the original is safe and the grid
    //    falls back to it; the backfill endpoint can retry later.
    //    Videos skip this — sharp can't read them; their poster comes from
    //    the ffmpeg pipeline that /api/upload/complete dispatches.
    let thumbnailed = false;
    if (image.media_type !== "video") {
      try {
        await generateThumbnailsFromBuffer(body, image.event_id, image.filename);
        thumbnailed = true;
      } catch (thumbErr) {
        console.error(`Thumbnail generation failed for ${imageId}:`, thumbErr);
      }
    }

    // 3. Record thumbnail success with the service client (bypasses RLS for
    //    this server-side write). Status is set by /api/upload/complete.
    if (thumbnailed) {
      const service = createServiceClient();
      await service
        .from("images")
        .update({ thumbnail_generated: true })
        .eq("id", imageId);

      // Uploads straight into a website section (TDP Website gallery) can only
      // publish once thumbnails exist — that's now. No-op for everything else;
      // non-fatal because any later membership change re-syncs.
      try {
        await syncSitePublication(service, [imageId]);
      } catch (syncErr) {
        console.error(`Site publication sync failed for ${imageId}:`, syncErr);
      }
    }

    return NextResponse.json({ success: true, imageId, thumbnailed });
  } catch (error) {
    console.error("File upload error:", error);
    return NextResponse.json(
      { error: "Failed to upload file" },
      { status: 500 }
    );
  }
}
