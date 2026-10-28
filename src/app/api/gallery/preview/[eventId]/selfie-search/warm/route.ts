import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { warmFaceDetector } from "@/lib/crew-faces/store";
import { detectorRecentlyUsed, eventHasFaces } from "@/lib/faces/selfie-availability";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/gallery/preview/[eventId]/selfie-search/warm
 *
 * The owner's preview twin of the guest warm-up: the gallery component is
 * shared, so opening "Find my photos" in a preview pings this base. Gated on
 * ownership instead of the share. The preview only shows the button when a
 * guest would see it (toggle on, faces present), so no toggle check is needed
 * here; it still skips a faceless gallery and a detector used in the last
 * 8 minutes.
 */
export async function POST(
  _request: Request,
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
    if (!event?.user_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (!process.env.MODAL_AI_SELFIE_URL || !(await eventHasFaces(supabase, eventId))) {
      return NextResponse.json({ warmed: false, reason: "unavailable" });
    }
    if (await detectorRecentlyUsed(supabase)) {
      return NextResponse.json({ warmed: false, reason: "already-warm" });
    }

    const result = await warmFaceDetector(event.user_id, { eventId, source: "preview" });
    return NextResponse.json({ warmed: result.ok, seconds: result.seconds });
  } catch (error) {
    await reportSystemError("gallery.preview-selfie-warm", error, { eventId });
    return NextResponse.json({ warmed: false }, { status: 500 });
  }
}
