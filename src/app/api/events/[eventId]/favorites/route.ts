import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/events/[eventId]/favorites
 *
 * Authenticated endpoint — returns all favorites across all shares
 * for an event, grouped by client.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Get all shares for this event
    const { data: shares, error: sharesError } = await supabase
      .from("shares")
      .select("id, slug, created_at")
      .eq("event_id", eventId);

    if (sharesError) throw sharesError;

    if (!shares || shares.length === 0) {
      return NextResponse.json({ clients: [] });
    }

    const shareIds = shares.map((s) => s.id);

    // Get all favorites across all shares
    const { data: favorites, error: favError } = await supabase
      .from("favorites")
      .select("image_id, share_id, client_name, client_email, created_at")
      .in("share_id", shareIds)
      .order("created_at", { ascending: false });

    if (favError) throw favError;

    // Group by client (name + email combo)
    const clientMap = new Map<
      string,
      {
        name: string | null;
        email: string | null;
        imageIds: string[];
        shareSlug: string;
        createdAt: string;
      }
    >();

    for (const fav of favorites || []) {
      const key = `${fav.client_email || "anon"}_${fav.client_name || ""}`;
      const share = shares.find((s) => s.id === fav.share_id);

      if (!clientMap.has(key)) {
        clientMap.set(key, {
          name: fav.client_name,
          email: fav.client_email,
          imageIds: [],
          shareSlug: share?.slug || "",
          createdAt: fav.created_at,
        });
      }

      clientMap.get(key)!.imageIds.push(fav.image_id);
    }

    const clients = Array.from(clientMap.values()).map((c) => ({
      name: c.name || "Anonymous",
      email: c.email,
      favoriteCount: c.imageIds.length,
      imageIds: c.imageIds,
      shareSlug: c.shareSlug,
      lastActivity: c.createdAt,
    }));

    return NextResponse.json({ clients, totalFavorites: favorites?.length || 0 });
  } catch (error) {
    console.error("Event favorites error:", error);
    return NextResponse.json(
      { error: "Failed to load favorites" },
      { status: 500 }
    );
  }
}
