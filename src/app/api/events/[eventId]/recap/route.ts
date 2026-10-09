import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { normalizeRecap, recapPassesFloor } from "@/lib/recap/normalize";
import { snapshotRecap } from "@/lib/recap/snapshot";
import { readRecapSettings } from "@/lib/recap/payload";
import { getPresignedDownloadUrl } from "@/lib/r2/client";

/**
 * The owner's view of an event's delivery recap.
 *
 *   GET  → the stored snapshot (or null), when it was fetched, and whether it
 *          clears the floor the email card requires.
 *   POST → re-fetch from SPS and store ("Refresh numbers" on the share page).
 *          A refresh that fails leaves the stored snapshot alone and says why.
 *
 * `getAuthUser()` hands back the SERVICE client, so the ownership check below
 * is the authorization, not a courtesy (GOTCHAS: this shipped as an IDOR twice).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { eventId } = await params;

    const { data: event } = await supabase
      .from("events")
      .select("id, recap, recap_fetched_at, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const recap = normalizeRecap(event.recap);
    const logoKey = readRecapSettings(event.settings).clientLogoKey;
    return NextResponse.json({
      recap,
      fetchedAt: event.recap_fetched_at,
      passesFloor: recapPassesFloor(recap),
      clientLogoUrl: logoKey ? await getPresignedDownloadUrl(logoKey, 3600) : null,
    });
  } catch (err) {
    await reportSystemError("events/recap:get", err);
    return NextResponse.json({ error: "Failed to read recap" }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { eventId } = await params;

    const { data: owned } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!owned) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const outcome = await snapshotRecap(supabase, eventId);
    if (outcome.kind === "stored") {
      return NextResponse.json({
        recap: outcome.recap,
        fetchedAt: new Date().toISOString(),
        passesFloor: recapPassesFloor(outcome.recap),
      });
    }
    const message =
      outcome.kind === "not-linked"
        ? "This gallery is not linked to a SimplePhotoShare event."
        : outcome.kind === "gone"
          ? "SimplePhotoShare no longer has this event; the stored numbers are kept."
          : outcome.message;
    return NextResponse.json({ error: message, kind: outcome.kind }, { status: 409 });
  } catch (err) {
    await reportSystemError("events/recap:refresh", err);
    return NextResponse.json({ error: "Failed to refresh recap" }, { status: 500 });
  }
}
