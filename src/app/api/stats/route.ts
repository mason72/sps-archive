import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/stats
 * Dashboard-level stats for the authenticated photographer.
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // 1. Get event IDs for this user
    const { data: userEvents, error: eventsError } = await supabase
      .from("events")
      .select("id")
      .eq("user_id", user!.id);

    if (eventsError) throw eventsError;

    const eventIds = (userEvents || []).map((e) => e.id);
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
    const [imagesResult, sharesResult] = await Promise.all([
      // Total images across all events
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .in("event_id", eventIds),

      // All shares (for view count + favorite lookups). Shares carry no
      // user_id — ownership is transitive through the event, so it has to be
      // an inner join. Filtering on a column that doesn't exist reads as an
      // empty result set, which is how this silently served 0 views for months.
      supabase
        .from("shares")
        .select("id, view_count, events!inner(user_id)")
        .eq("events.user_id", user!.id),
    ]);

    if (imagesResult.error) throw imagesResult.error;
    if (sharesResult.error) throw sharesResult.error;

    const totalImages = imagesResult.count ?? 0;
    const shares = sharesResult.data || [];
    const totalViews = shares.reduce(
      (sum, s) => sum + (s.view_count || 0),
      0
    );

    // 3. Count favorites across all shares
    let totalFavorites = 0;
    if (shares.length > 0) {
      const shareIds = shares.map((s) => s.id);
      const { count, error: favoritesError } = await supabase
        .from("favorites")
        .select("id", { count: "exact", head: true })
        .in("share_id", shareIds);
      if (favoritesError) throw favoritesError;
      totalFavorites = count ?? 0;
    }

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
