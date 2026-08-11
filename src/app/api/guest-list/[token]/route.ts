import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { getObjectBuffer } from "@/lib/r2/client";
import { findEventByGuestListToken } from "@/lib/guest-list/store";
import { logActivity } from "@/lib/analytics/log";

export const runtime = "nodejs";

/**
 * GET /api/guest-list/[token]
 *
 * The one door to a client's guest-list spreadsheet. Reached only from the
 * link in the publish email — never linked from the gallery, never listed
 * anywhere, never discoverable from a share slug.
 *
 * The token IS the authorisation, so it is treated like one: 32 bytes of
 * entropy, stored only as a SHA-256 hash, rate-limited per IP so it can't be
 * ground down, and re-checked against a LIVE share on every request. Revoking
 * the sheet or unpublishing the gallery kills every link already sent.
 *
 * Every download is logged. This file names real people and their email
 * addresses; who fetched it and when is part of handing it over responsibly.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  try {
    const supabase = createServiceClient();

    // A token is a secret: throttle guessing before touching the database.
    if (!(await checkAuthRateLimit(supabase, "guest-list", token.slice(0, 8), clientIp(request)))) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }
    if (!token || token.length < 32) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const match = await findEventByGuestListToken(supabase, token);
    if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // The sheet is an accompaniment to a published gallery. If the gallery is
    // unpublished or expired, the guest list goes with it — a client who can no
    // longer see the photos must not still be able to pull the attendee list.
    const { data: shares } = await supabase
      .from("shares")
      .select("id, is_active, expires_at")
      .eq("event_id", match.eventId)
      .eq("is_active", true);
    const live = (shares ?? []).some(
      (s) =>
        !(s as { expires_at: string | null }).expires_at ||
        new Date((s as { expires_at: string }).expires_at) > new Date()
    );
    if (!live) {
      return NextResponse.json(
        { error: "This gallery is no longer available" },
        { status: 410 }
      );
    }

    const body = await getObjectBuffer(match.meta.key, 5 * 1024 * 1024);

    if (match.userId) {
      logActivity({
        userId: match.userId,
        action: "guest_list_download",
        eventId: match.eventId,
      });
    }

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": match.meta.contentType ?? "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${match.meta.filename.replace(/"/g, "")}"`,
        // Never cached by a proxy — this is one client's personal data.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    await reportSystemError("guest-list.download", error, {});
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
