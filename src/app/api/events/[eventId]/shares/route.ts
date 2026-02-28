import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/events/[eventId]/shares
 * List all share links for an event with analytics.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Verify ownership
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: rawShares, error } = await supabase
      .from("shares")
      .select(
        "id, slug, share_type, view_count, last_viewed_at, created_at, allow_download, allow_favorites"
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const shares = (rawShares || []).map((s) => ({
      id: s.id,
      slug: s.slug,
      shareType: s.share_type,
      viewCount: s.view_count,
      lastViewedAt: s.last_viewed_at,
      createdAt: s.created_at,
      allowDownload: s.allow_download,
      allowFavorites: s.allow_favorites,
    }));

    return NextResponse.json({ shares });
  } catch (error) {
    console.error("List shares error:", error);
    return NextResponse.json(
      { error: "Failed to load shares" },
      { status: 500 }
    );
  }
}
