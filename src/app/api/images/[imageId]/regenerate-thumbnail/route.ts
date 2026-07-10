import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { generateThumbnails } from "@/lib/thumbnails/generate";
import { inngest } from "@/lib/inngest/client";
import { reportSystemError } from "@/lib/monitoring/report";

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
      .select("id, r2_key, event_id, filename, media_type")
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

    // Video posters come from the ffmpeg pipeline, not sharp — re-queue the
    // job and let the tile keep its placeholder until the poster lands.
    if (image.media_type === "video") {
      try {
        await inngest.send({
          name: "video/uploaded",
          data: { imageId, eventId: image.event_id, r2Key: image.r2_key },
        });
      } catch (sendErr) {
        console.error(`Video poster re-queue failed for ${imageId}:`, sendErr);
        return NextResponse.json(
          { error: "Failed to re-queue video poster" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, queued: true });
    }

    // Rebuild all three thumbnail sizes from the original.
    try {
      const thumbs = await generateThumbnails(image.r2_key, image.event_id, image.filename);
      if (thumbs.dominantColor) {
        await supabase
          .from("images")
          .update({ dominant_color: thumbs.dominantColor })
          .eq("id", imageId);
      }
    } catch (genErr) {
      console.error(`Regenerate thumbnail failed for ${imageId}:`, genErr);
      // NoSuchKey = the ORIGINAL is gone: this is a ghost row (a DB record
      // whose binary never landed — the eBay HEADSHOTS failure mode), not a
      // thumbnail problem. Report it distinctly and answer 410 so the client
      // stops retrying something that can never succeed; the nightly
      // reconciler deletes confirmed ghosts.
      const missingOriginal =
        (genErr as { Code?: string })?.Code === "NoSuchKey" ||
        (genErr as { name?: string })?.name === "NoSuchKey";
      await reportSystemError(
        missingOriginal
          ? "thumbnails.regenerate-missing-original"
          : "thumbnails.regenerate",
        genErr,
        { imageId, eventId: image.event_id, r2Key: image.r2_key }
      );
      return NextResponse.json(
        {
          error: missingOriginal
            ? "Original file is missing from storage"
            : "Failed to regenerate thumbnail",
        },
        { status: missingOriginal ? 410 : 500 }
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
    await reportSystemError("thumbnails.regenerate", error, {});
    return NextResponse.json(
      { error: "Failed to regenerate thumbnail" },
      { status: 500 }
    );
  }
}
