import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { buildHighlightsPlan } from "@/lib/highlights/propose";

/**
 * GET /api/events/[eventId]/highlights/plan
 *
 * What the generator knows about an event before proposing anything: how many
 * MOMENTS it holds (not files — a branded activation ships every capture twice),
 * whether indexing is finished, and whether this photographer has enough past
 * picks to fit a direction.
 *
 * Deliberately does not train the direction. Answering "is one available" by
 * fitting one cost 17s on a cold lambda; the count answers it in a round trip,
 * and fitting belongs behind the generate button where a spinner is expected.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // getAuthUser hands back the SERVICE client (RLS bypassed) — ownership is
    // this check plus the owner-scoped joins inside buildHighlightsPlan.
    const { data: event, error: evErr } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const plan = await buildHighlightsPlan(supabase, eventId, user.id);
    return NextResponse.json(plan);
  } catch (err) {
    await reportSystemError("highlights-plan", err, { eventId });
    return NextResponse.json(
      { error: "Could not read this event" },
      { status: 500 }
    );
  }
}
