import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import type { Json } from "@/lib/supabase/database.types";

/** Row shape returned by the activity_log select query */
interface ActivityRow {
  action: string;
  event_id: string | null;
  share_id: string | null;
  image_id: string | null;
  metadata: Json;
  created_at: string;
}

/**
 * GET /api/analytics/engagement?eventId=...&days=30
 * Returns per-event engagement breakdown: favorites, downloads, views over time.
 */
export async function GET(request: Request) {
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const userId = user!.id;
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");
  const days = Math.min(Number(url.searchParams.get("days") ?? 30), 90);

  const since = new Date();
  since.setDate(since.getDate() - days);

  // Build query — explicit type avoids Supabase generic inference issues on Vercel
  const baseQuery = supabase
    .from("activity_log")
    .select("action, event_id, share_id, image_id, metadata, created_at")
    .eq("user_id", userId)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(500);

  const { data: rawData, error } = eventId
    ? await baseQuery.eq("event_id", eventId)
    : await baseQuery;

  if (error) {
    console.error("[analytics/engagement] query error:", error);
    return NextResponse.json({ error: "Failed to load engagement data" }, { status: 500 });
  }

  const data = (rawData ?? []) as ActivityRow[];

  // Single-pass aggregation: by-event and by-image
  const byEvent: Record<string, { views: number; downloads: number; favorites: number }> = {};
  const imageEngagement: Record<string, { downloads: number; favorites: number }> = {};

  for (const row of data) {
    const eid = row.event_id ?? "unknown";
    if (!byEvent[eid]) byEvent[eid] = { views: 0, downloads: 0, favorites: 0 };

    switch (row.action) {
      case "share_view":
        byEvent[eid].views++;
        break;
      case "image_download":
      case "gallery_download":
        byEvent[eid].downloads++;
        break;
      case "image_favorite":
        byEvent[eid].favorites++;
        break;
    }

    // Image-level engagement (downloads + favorites with image_id)
    if (row.image_id) {
      if (!imageEngagement[row.image_id]) {
        imageEngagement[row.image_id] = { downloads: 0, favorites: 0 };
      }
      if (row.action === "image_download") imageEngagement[row.image_id].downloads++;
      if (row.action === "image_favorite") imageEngagement[row.image_id].favorites++;
    }
  }

  // Sort top images by total engagement
  const topImages = Object.entries(imageEngagement)
    .map(([imageId, stats]) => ({
      imageId,
      ...stats,
      total: stats.downloads + stats.favorites,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);

  return NextResponse.json({
    byEvent,
    topImages,
    recentActivity: data.slice(0, 20).map((row) => ({
      action: row.action,
      eventId: row.event_id,
      imageId: row.image_id,
      createdAt: row.created_at,
      metadata: row.metadata,
    })),
  });
}
