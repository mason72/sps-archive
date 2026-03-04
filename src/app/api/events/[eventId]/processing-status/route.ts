import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/events/[eventId]/processing-status
 *
 * Returns processing stats for all images in an event.
 * Used by the client to show a progress indicator during AI processing.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Verify event ownership
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    if (event.user_id !== user!.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Count images by processing_status
    const statuses = ["pending", "processing", "complete", "failed"] as const;

    const counts = await Promise.all(
      statuses.map(async (status) => {
        const { count } = await supabase
          .from("images")
          .select("*", { count: "exact", head: true })
          .eq("event_id", eventId)
          .eq("processing_status", status);
        return { status, count: count ?? 0 };
      })
    );

    const result = counts.reduce(
      (acc, { status, count }) => ({ ...acc, [status]: count }),
      { pending: 0, processing: 0, complete: 0, failed: 0 }
    );

    // Check AI analysis status from event settings
    const { data: eventSettings } = await supabase
      .from("events")
      .select("settings, event_type")
      .eq("id", eventId)
      .single();

    const settings = (eventSettings?.settings ?? {}) as Record<string, unknown>;
    const allDone = result.pending === 0 && result.processing === 0;

    return NextResponse.json({
      total: result.pending + result.processing + result.complete + result.failed,
      ...result,
      analysis: {
        complete: !!settings.ai_detected_type,
        detectedType: settings.ai_detected_type || null,
        confidence: settings.ai_confidence || null,
        eventType: eventSettings?.event_type || null,
      },
      stage: !allDone
        ? "processing"
        : settings.ai_detected_type
          ? "ready"
          : "analyzing",
    });
  } catch (error) {
    console.error("Processing status error:", error);
    return NextResponse.json(
      { error: "Failed to get processing status" },
      { status: 500 }
    );
  }
}
