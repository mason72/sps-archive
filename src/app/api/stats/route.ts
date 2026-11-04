import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { countAcross, readAllRows } from "@/lib/supabase/paged";

/**
 * GET /api/stats
 * Dashboard-level stats for the authenticated photographer.
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // 1. Get event IDs for this user — paged, or the count tops out at 1,000.
    const userEvents = await readAllRows(() =>
      supabase.from("events").select("id").eq("user_id", user!.id)
    );

    const eventIds = userEvents.map((e) => e.id);
    const totalEvents = eventIds.length;

    if (totalEvents === 0) {
      return NextResponse.json({
        totalEvents: 0,
        totalImages: 0,
        totalViews: 0,
        totalFavorites: 0,
      });
    }

    // 2. Run remaining queries in parallel
    const [totalImages, shares] = await Promise.all([
      // Total images across all events
      countAcross(eventIds, "images", (chunk) =>
        supabase
          .from("images")
          .select("id", { count: "exact", head: true })
          .in("event_id", chunk)
          // Photos, not cover uploads (client logos; lesson 184).
          .eq("is_cover_upload", false)
      ),

      // All shares (for view count + favorite lookups). Shares carry no
      // user_id — ownership is transitive through the event, so it has to be
      // an inner join. Filtering on a column that doesn't exist reads as an
      // empty result set, which is how this silently served 0 views for months.
      // Paged: the busiest account has 1,516 shares, and a bare select stops
      // at 1,000 with no error.
      readAllRows(() =>
        supabase
          .from("shares")
          .select("id, view_count, events!inner(user_id)")
          .eq("events.user_id", user!.id)
      ),
    ]);

    const totalViews = shares.reduce(
      (sum, s) => sum + (s.view_count || 0),
      0
    );

    // 3. Count favorites across all shares
    const totalFavorites =
      shares.length > 0
        ? await countAcross(
            shares.map((s) => s.id),
            "favorites",
            (chunk) =>
              supabase
                .from("favorites")
                .select("id", { count: "exact", head: true })
                .in("share_id", chunk)
          )
        : 0;

    return NextResponse.json({
      totalEvents,
      totalImages,
      totalViews,
      totalFavorites,
    });
  } catch (error) {
    await reportSystemError("api/stats", error);
    return NextResponse.json(
      { error: "Failed to load stats" },
      { status: 500 }
    );
  }
}
