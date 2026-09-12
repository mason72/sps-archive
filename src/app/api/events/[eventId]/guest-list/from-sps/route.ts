import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { uploadToR2 } from "@/lib/r2/client";
import { getSpsToken } from "@/lib/sps-integration/connection";
import { readSpsEventId } from "@/lib/sps-integration/event-link";
import { fetchGuestList, SpsPullError } from "@/lib/sps-integration/pull-client";
import { guestListKey, hashToken, mintToken } from "@/lib/guest-list/store";

export const runtime = "nodejs";

/**
 * POST /api/events/[eventId]/guest-list/from-sps
 *
 * Pull the guest list straight from SPS instead of exporting it by hand.
 * Mason, 2026-09-11: *"when I am using an event I imported from SPS, I should
 * be able to generate/link the spreadsheet automatically. This still forces me
 * to go back to SPS to export it."*
 *
 * Deliberately a SIBLING of the manual upload rather than a branch inside it:
 * the two differ only in where the bytes come from, and everything after that
 * — the R2 key, the minted token, the `settings.guestList` shape, the
 * once-only token return — is identical and must stay identical, or the email
 * composer would have to care which route attached the sheet. The one visible
 * difference is `source`, which exists precisely to record the provenance.
 *
 * Like the upload it mints a FRESH token, so pulling an updated sheet kills
 * every link already emailed. That is the same trade as Replace, and the UI
 * says so before the click.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // getAuthUser hands back the SERVICE client, which bypasses RLS — the
    // user_id filter here is the ownership check, not a convenience.
    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const settings = ((event as { settings: Record<string, unknown> | null })
      .settings ?? {}) as Record<string, unknown>;

    const spsEventId = readSpsEventId(settings);
    if (!spsEventId) {
      return NextResponse.json(
        { error: "This gallery wasn't imported from SPS, so there's nothing to pull." },
        { status: 400 }
      );
    }

    const token = await getSpsToken(supabase, user!.id);
    if (!token) {
      return NextResponse.json(
        { error: "Connect your SPS account first, in Settings → Connections." },
        { status: 400 }
      );
    }

    const sheet = await fetchGuestList(token, spsEventId);

    const key = guestListKey(eventId, "xlsx");
    await uploadToR2(key, sheet.bytes, sheet.contentType);

    const downloadToken = mintToken();
    const { error: updateErr } = await supabase
      .from("events")
      .update({
        settings: {
          ...settings,
          guestList: {
            key,
            filename: sheet.filename,
            uploadedAt: new Date().toISOString(),
            tokenHash: hashToken(downloadToken),
            source: "sps-api",
            contentType: sheet.contentType,
            sizeBytes: sheet.bytes.length,
          },
        } as never,
      })
      .eq("id", eventId)
      .eq("user_id", user!.id);
    if (updateErr) throw updateErr;

    return NextResponse.json({
      // Returned ONCE; only the hash is stored.
      token: downloadToken,
      filename: sheet.filename,
      sizeBytes: sheet.bytes.length,
      guestCount: sheet.guestCount,
    });
  } catch (error) {
    // An SPS-side refusal is the user's problem to act on (wrong account, no
    // guests yet, SPS unreachable), so it is surfaced verbatim and NOT filed as
    // a system error — an alert per "nobody has checked in yet" would train
    // Mason to ignore the alerts that matter.
    if (error instanceof SpsPullError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.kind === "not-found" ? 404 : 502 }
      );
    }
    await reportSystemError("guest-list.from-sps", error, { eventId });
    return NextResponse.json({ error: "Could not pull the guest list" }, { status: 500 });
  }
}
