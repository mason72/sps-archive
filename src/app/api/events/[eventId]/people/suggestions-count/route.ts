import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { dismissedSetFrom, loadPeopleData } from "@/lib/faces/people-data";

export const runtime = "nodejs";

/**
 * GET /api/events/[eventId]/people/suggestions-count
 * Cheap-ish count for the People-button badge (no presigning). Ownership-scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const data = await loadPeopleData(supabase, eventId, dismissedSetFrom(event.settings));
    return NextResponse.json({
      count: data.suggestions.mislabels.length + data.suggestions.merges.length,
    });
  } catch (error) {
    await reportSystemError("people.suggestions-count", error, { eventId });
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
