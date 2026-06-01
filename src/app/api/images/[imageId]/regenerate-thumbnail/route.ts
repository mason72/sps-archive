import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { generateThumbnails } from "@/lib/thumbnails/generate";

// Thumbnail regeneration downloads the original + runs sharp — needs Node.
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/images/[imageId]/regenerate-thumbnail
 *
 * Self-healing endpoint: when the grid finds a thumbnail missing/broken, it
 * calls this to rebuild the thumbnail from the (intact) original in R2, then
 * gets back a fresh signed thumbnail URL. This makes a missing thumbnail a
 * one-time, self-correcting blip instead of a permanent gray tile — and means
 * we never again depend on a manual repair script.
 *
 * Owner-only (verified through the image → event → user chain).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageId } = await params;

    // Load the image + verify the caller owns its event.
    const { data: image, error: imageError } = await supabase
      .from("images")
      .select("id, r2_key, event_id, filename")
      .eq("id", imageId)
      .single();

    if (imageError || !image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", image.event_id)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Rebuild all three thumbnail sizes from the original.
    try {
      await generateThumbnails(image.r2_key, image.event_id, image.filename);
    } catch (genErr) {
      console.error(`Regenerate thumbnail failed for ${imageId}:`, genErr);
      return NextResponse.json(
        { error: "Failed to regenerate thumbnail" },
        { status: 500 }
      );
    }

    await supabase
      .from("images")
      .update({ thumbnail_generated: true })
      .eq("id", imageId);

    // Return a fresh signed URL the client can swap in immediately.
    const thumbnailUrl = await getPresignedDownloadUrl(
      getThumbnailKey(image.r2_key),
      14400
    );

    return NextResponse.json({ success: true, thumbnailUrl });
  } catch (error) {
    console.error("Regenerate thumbnail error:", error);
    return NextResponse.json(
      { error: "Failed to regenerate thumbnail" },
      { status: 500 }
    );
  }
}
