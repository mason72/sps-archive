import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";
import { generateThumbnails } from "@/lib/thumbnails/generate";

/**
 * POST /api/admin/batch-thumbnails
 *
 * Backfill thumbnails for existing images that don't have them yet.
 * Requires authenticated user. Processes images in batches with concurrency control.
 *
 * Body (optional):
 *   - batchSize: number of images per batch (default: 20, max: 50)
 *   - eventId: limit to a specific event (optional)
 *
 * Returns: { processed, failed, remaining }
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authenticated user
    const userSupabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await userSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 20, 50);
    const eventId = body.eventId as string | undefined;

    // Use service client to bypass RLS for admin operations
    const supabase = createServiceClient();

    // Query images that need thumbnails — only for this user's events
    let query = supabase
      .from("images")
      .select("id, r2_key, event_id, filename, events!inner(user_id)")
      .eq("thumbnail_generated", false)
      .eq("events.user_id", user.id)
      .limit(batchSize);

    if (eventId) {
      query = query.eq("event_id", eventId);
    }

    const { data: images, error: fetchError } = await query;

    if (fetchError) throw fetchError;

    if (!images || images.length === 0) {
      // Count remaining for the user across all events
      const { count } = await supabase
        .from("images")
        .select("id, events!inner(user_id)", { count: "exact", head: true })
        .eq("thumbnail_generated", false)
        .eq("events.user_id", user.id);

      return NextResponse.json({
        processed: 0,
        failed: 0,
        remaining: count || 0,
        message: "No images need thumbnail generation",
      });
    }

    // Process in parallel with concurrency limit (5 at a time)
    let processed = 0;
    let failed = 0;
    const concurrency = 5;

    for (let i = 0; i < images.length; i += concurrency) {
      const batch = images.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (image) => {
          await generateThumbnails(image.r2_key, image.event_id, image.filename);
          await supabase
            .from("images")
            .update({ thumbnail_generated: true })
            .eq("id", image.id);
        })
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          processed++;
        } else {
          failed++;
          console.error("Batch thumbnail error:", result.reason);
        }
      }
    }

    // Count remaining
    const { count: remaining } = await supabase
      .from("images")
      .select("id, events!inner(user_id)", { count: "exact", head: true })
      .eq("thumbnail_generated", false)
      .eq("events.user_id", user.id);

    return NextResponse.json({
      processed,
      failed,
      remaining: remaining || 0,
      message:
        remaining && remaining > 0
          ? `Processed ${processed} images. ${remaining} still need thumbnails — call again to continue.`
          : `All done! ${processed} images processed.`,
    });
  } catch (error) {
    console.error("Batch thumbnail error:", error);
    return NextResponse.json(
      { error: "Batch thumbnail generation failed" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/batch-thumbnails
 *
 * Check how many images still need thumbnails.
 */
export async function GET() {
  try {
    const userSupabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await userSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServiceClient();

    const { count: needsThumbnails } = await supabase
      .from("images")
      .select("id, events!inner(user_id)", { count: "exact", head: true })
      .eq("thumbnail_generated", false)
      .eq("events.user_id", user.id);

    const { count: total } = await supabase
      .from("images")
      .select("id, events!inner(user_id)", { count: "exact", head: true })
      .eq("events.user_id", user.id);

    return NextResponse.json({
      total: total || 0,
      needsThumbnails: needsThumbnails || 0,
      hasThumbnails: (total || 0) - (needsThumbnails || 0),
    });
  } catch (error) {
    console.error("Batch thumbnail status error:", error);
    return NextResponse.json(
      { error: "Failed to check thumbnail status" },
      { status: 500 }
    );
  }
}
