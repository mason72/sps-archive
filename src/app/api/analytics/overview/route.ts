import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/analytics/overview
 * Returns aggregate stats + 30-day sparkline data for the dashboard.
 */
export async function GET() {
  const { user, supabase, error: authError } = await getAuthUser();
  if (authError) return authError;

  const userId = user!.id;

  // Fetch daily activity via the aggregate SQL function
  const { data: dailyData, error: dailyError } = await supabase.rpc(
    "get_daily_activity",
    { p_user_id: userId, p_days: 30 }
  );

  if (dailyError) {
    console.error("[analytics/overview] daily activity error:", dailyError);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }

  // Aggregate totals from the 30-day window
  const totals: Record<string, number> = {};
  const sparkline: Record<string, Record<string, number>> = {};

  for (const row of dailyData ?? []) {
    totals[row.action] = (totals[row.action] ?? 0) + Number(row.total);

    if (!sparkline[row.day]) sparkline[row.day] = {};
    sparkline[row.day][row.action] = Number(row.total);
  }

  // Build sparkline array (fill in missing days with zeroes)
  const days: string[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().split("T")[0]);
  }

  const sparklineArray = days.map((day) => ({
    date: day,
    views: sparkline[day]?.share_view ?? 0,
    downloads: (sparkline[day]?.image_download ?? 0) + (sparkline[day]?.gallery_download ?? 0),
    favorites: sparkline[day]?.image_favorite ?? 0,
  }));

  // Get all-time totals in a single scan (migration 011: get_activity_totals)
  const { data: totalsData, error: totalsError } = await supabase.rpc(
    "get_activity_totals",
    { p_user_id: userId }
  );

  if (totalsError) {
    console.error("[analytics/overview] totals error:", totalsError);
  }

  const allTime = (totalsData as { views: number; downloads: number; favorites: number; shares: number } | null) ?? {
    views: 0,
    downloads: 0,
    favorites: 0,
    shares: 0,
  };

  return NextResponse.json({
    totals: allTime,
    period30d: {
      views: totals.share_view ?? 0,
      downloads: (totals.image_download ?? 0) + (totals.gallery_download ?? 0),
      favorites: totals.image_favorite ?? 0,
    },
    sparkline: sparklineArray,
  });
}
