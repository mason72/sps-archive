import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { matchSelfie } from "@/lib/faces/selfie-match";

export const runtime = "nodejs";

/**
 * POST /api/gallery/preview/[eventId]/selfie-search   { imageBase64 }
 *
 * "Find my photos" in the owner's preview — the same matcher the guest route
 * uses (`matchSelfie`), gated on ownership instead of the share.
 *
 * No share scope to intersect (a preview is the whole event) and no
 * `selfieSearch` toggle check: that setting decides what GUESTS get, and a
 * photographer testing the feature before switching it on for a client is
 * exactly who needs it to answer. The selfie is still embedded in memory and
 * never stored.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, user_id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event?.user_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!process.env.MODAL_AI_SELFIE_URL) {
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const { imageBase64 } = (await request.json()) as { imageBase64?: string };
    if (!imageBase64 || imageBase64.length > 3_000_000) {
      return NextResponse.json({ error: "Bad selfie payload" }, { status: 400 });
    }

    const match = await matchSelfie(supabase, {
      userId: event.user_id,
      eventId,
      imageBase64,
    });
    if (match.noFace) {
      return NextResponse.json({ results: [], noFace: true });
    }

    return NextResponse.json({
      results: match.imageIds,
      matchedPerson: match.matchedPerson,
    });
  } catch (error) {
    await reportSystemError("gallery.preview-selfie-search", error, { eventId });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
