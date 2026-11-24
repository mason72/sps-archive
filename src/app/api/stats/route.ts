import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getDashboardStats } from "@/lib/dashboard/stats";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/stats
 * Dashboard-level stats for the authenticated photographer, served from a
 * per-account cache (src/lib/dashboard/stats.ts).
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    return NextResponse.json(await getDashboardStats(supabase, user!.id));
  } catch (error) {
    await reportSystemError("api/stats", error);
    return NextResponse.json(
      { error: "Failed to load stats" },
      { status: 500 }
    );
  }
}
