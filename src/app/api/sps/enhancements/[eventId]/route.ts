import { NextRequest, NextResponse } from "next/server";
import { authenticateSPSRequest } from "@/lib/sps-integration/auth";
import { generateEnhancements } from "@/lib/sps-integration/import";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/sps/enhancements/[eventId]
 *
 * Returns AI-generated enhancements for an archived event.
 * SPS polls this endpoint after triggering an import to get
 * back stacks, sections, and per-image metadata.
 *
 * Auth: Supabase JWT (Authorization: Bearer) or API key (X-SPS-Key)
 *
 * Query params:
 *   ?userId=<id>  — Required when using API key auth (not JWT)
 *
 * Response:
 *   - 200: ArchiveEnhancements (processing complete)
 *   - 202: { status: "processing", progress } (still working)
 *   - 404: Event not found or not owned by user
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { eventId } = await params;

    // For GET requests, userId comes from query string (API key auth)
    const searchParams = request.nextUrl.searchParams;
    const queryUserId = searchParams.get("userId") || undefined;

    const auth = await authenticateSPSRequest(request, queryUserId);
    if (!auth.authenticated) {
      return NextResponse.json(
        { error: auth.error },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();

    // Verify event exists and belongs to the authenticated user
    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id, name, settings")
      .eq("id", eventId)
      .eq("user_id", auth.userId)
      .single();

    if (eventError || !event) {
      return NextResponse.json(
        { error: "Event not found" },
        { status: 404 }
      );
    }

    // Extract spsEventId from event settings
    const settings = event.settings as Record<string, unknown> | null;
    const spsEventId = (settings?.spsEventId as string) || "";

    // Check processing progress
    const { count: totalImages } = await supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId);

    const { count: pendingImages } = await supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .in("processing_status", ["pending", "processing"]);

    const { count: completeImages } = await supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("processing_status", "complete");

    const total = totalImages || 0;
    const pending = pendingImages || 0;
    const complete = completeImages || 0;

    // If still processing, return progress
    if (pending > 0) {
      return NextResponse.json(
        {
          status: "processing",
          eventId,
          progress: {
            total,
            complete,
            pending,
            percentComplete: total > 0 ? Math.round((complete / total) * 100) : 0,
          },
        },
        { status: 202 }
      );
    }

    // All done — generate and return enhancements
    const enhancements = await generateEnhancements(eventId, spsEventId);

    return NextResponse.json({
      status: "complete",
      ...enhancements,
    });
  } catch (error) {
    console.error("SPS enhancements error:", error);

    const message =
      error instanceof Error ? error.message : "Failed to generate enhancements";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
