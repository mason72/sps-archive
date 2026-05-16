import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/events/[eventId]/processing-status
 *
 * Returns processing stats for all images in an event. Used by the client
 * to show a progress indicator and surface failed images.
 *
 * Uses the event_image_status_counts RPC (one query, one round-trip)
 * instead of four sequential COUNT queries per poll.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // RLS enforces ownership — non-owned eventIds return 0 from the RPC.
    // We still do an explicit fetch to distinguish "your event with 0 rows"
    // from "not your event" (404) so the UI shows the right state.
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: counts, error: countsError } = await supabase.rpc(
      "event_image_status_counts",
      { p_event_id: eventId }
    );

    if (countsError) throw countsError;
    const row = counts?.[0] ?? {
      total: 0,
      pending: 0,
      processing: 0,
      complete: 0,
      failed: 0,
    };

    // Pull the most recent failures (cap small) so the UI can show what
    // went wrong instead of just "N failed".
    let recentFailures: Array<{ id: string; lastError: string | null; originalFilename: string }> = [];
    if (row.failed > 0) {
      const { data } = await supabase
        .from("images")
        .select("id, last_error, original_filename")
        .eq("event_id", eventId)
        .eq("processing_status", "failed")
        .order("updated_at", { ascending: false })
        .limit(5);
      recentFailures = (data ?? []).map((r) => ({
        id: r.id,
        lastError: r.last_error,
        originalFilename: r.original_filename,
      }));
    }

    void user; // currently only used by RLS

    return NextResponse.json({
      total: Number(row.total),
      pending: Number(row.pending),
      processing: Number(row.processing),
      complete: Number(row.complete),
      failed: Number(row.failed),
      recentFailures,
    });
  } catch (error) {
    console.error("Processing status error:", error);
    return NextResponse.json(
      { error: "Failed to get processing status" },
      { status: 500 }
    );
  }
}
