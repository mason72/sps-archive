import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { log } from "@/lib/log";

/**
 * GET /api/dashboard/recent-activity
 *
 * Lightweight feed of the photographer's last few client interactions.
 * Used by the dashboard's "Recent Activity" strip to surface what's
 * happening without forcing them into the full analytics page.
 *
 * Returns up to 10 rows with friendly action + the event name attached
 * so the UI can render a single-line summary like
 *   "Sarah picked 3 favorites — Johnson Wedding · 2 hours ago"
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // RLS scopes activity_log to the caller. Pull a small recent window.
    const { data: rows, error: queryError } = await supabase
      .from("activity_log")
      .select("action, event_id, image_id, share_id, created_at, metadata")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (queryError) throw queryError;

    // Join event names in one batch.
    const eventIds = Array.from(
      new Set((rows ?? []).map((r) => r.event_id).filter(Boolean) as string[])
    );

    let eventNames: Record<string, string> = {};
    if (eventIds.length > 0) {
      const { data: events } = await supabase
        .from("events")
        .select("id, name")
        .in("id", eventIds);
      eventNames = Object.fromEntries(
        (events ?? []).map((e) => [e.id, e.name])
      );
    }

    return NextResponse.json({
      activity: (rows ?? []).map((row) => ({
        action: row.action,
        eventId: row.event_id,
        imageId: row.image_id,
        shareId: row.share_id,
        createdAt: row.created_at,
        metadata: row.metadata,
        eventName: row.event_id ? eventNames[row.event_id] ?? null : null,
      })),
    });
  } catch (err) {
    log.error("dashboard/recent-activity", "request failed", { err });
    return NextResponse.json(
      { error: "Failed to load recent activity" },
      { status: 500 }
    );
  }
}
