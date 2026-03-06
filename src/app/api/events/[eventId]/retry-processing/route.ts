import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient, createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/events/[eventId]/retry-processing
 *
 * Retries processing for stuck/failed images in an event.
 * Resets their status to "pending" and re-sends Inngest events.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;

    // Auth check
    const userClient = await createServerSupabaseClient();
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify event ownership
    const supabase = createServiceClient();
    const { data: event } = await supabase
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Find stuck/failed images (pending, processing, or failed)
    const { data: stuckImages, error: queryError } = await supabase
      .from("images")
      .select("id, r2_key, processing_status")
      .eq("event_id", eventId)
      .in("processing_status", ["pending", "processing", "failed"]);

    if (queryError) throw queryError;
    if (!stuckImages || stuckImages.length === 0) {
      return NextResponse.json({ retried: 0, message: "No stuck images found" });
    }

    // Reset all to "pending"
    const imageIds = stuckImages.map((img) => img.id);
    await supabase
      .from("images")
      .update({ processing_status: "pending" })
      .in("id", imageIds);

    // Re-send Inngest events
    let retriedCount = 0;
    if (process.env.INNGEST_EVENT_KEY) {
      try {
        const { inngest } = await import("@/lib/inngest/client");

        const events = stuckImages
          .filter((img) => img.r2_key) // Only retry images that have an R2 key
          .map((img) => ({
            name: "image/uploaded" as const,
            data: {
              imageId: img.id,
              eventId,
              r2Key: img.r2_key,
            },
          }));

        if (events.length > 0) {
          await inngest.send(events);
          retriedCount = events.length;
        }
      } catch (inngestError) {
        console.error("Failed to send Inngest events for retry:", inngestError);
        return NextResponse.json(
          { error: "Failed to queue images for reprocessing" },
          { status: 500 }
        );
      }
    } else {
      // No Inngest — just reset the status so they show as pending
      retriedCount = imageIds.length;
    }

    return NextResponse.json({
      retried: retriedCount,
      message: `Queued ${retriedCount} image${retriedCount === 1 ? "" : "s"} for reprocessing`,
    });
  } catch (error) {
    console.error("Retry processing error:", error);
    return NextResponse.json(
      { error: "Failed to retry processing" },
      { status: 500 }
    );
  }
}
