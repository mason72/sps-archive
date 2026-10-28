import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";
import { resolveShareImageScope } from "@/lib/gallery/share-scope";
import { warmFaceDetector } from "@/lib/crew-faces/store";
import {
  detectorRecentlyUsed,
  selfieSearchAvailable,
} from "@/lib/faces/selfie-availability";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Per-instance guard: a cold start takes ~24 s and the usage row that
 * `detectorRecentlyUsed` reads is written only when the ping finishes, so
 * without this a room of guests opening the sheet together would each start
 * a ping. Instances do not share it; the database clock covers the rest.
 */
let warmingUntil = 0;

/**
 * POST /api/gallery/[slug]/selfie-search/warm
 *
 * Wakes the face detector when a guest opens "Find my photos", so the ~24 s
 * GPU cold start (measured on production, 2026-10-28) overlaps the time spent
 * lining up a selfie instead of following the shutter. Warm, the search
 * itself answers in about a second.
 *
 * Spends the owner's money, so it passes every gate the search does (share,
 * expiry, password cookie, scope, the same availability check that decides
 * whether the button shows) and then two of its own: no ping when the
 * detector was used in the last 8 minutes, and a tight per-IP budget.
 *
 * AWAITED: Vercel freezes a function once it responds, so a ping started
 * without being awaited is dropped. The browser fires it and never waits.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const supabase = createServiceClient();

    const { data: share } = await supabase
      .from("shares")
      .select("id, event_id, is_active, expires_at, password_hash, share_type, image_ids")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();
    if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }
    if (share.password_hash) {
      const cookie = request.cookies.get(`gallery_auth_${slug}`);
      if (cookie?.value !== share.id) {
        return NextResponse.json({ error: "Locked" }, { status: 401 });
      }
    }
    if (resolveShareImageScope(share).kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("user_id, settings")
      .eq("id", share.event_id)
      .single();
    if (!event?.user_id) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const sharing = ((event.settings ?? {}) as { sharing?: { selfieSearch?: boolean } })
      .sharing;
    if (!(await selfieSearchAvailable(supabase, share.event_id, sharing))) {
      return NextResponse.json({ warmed: false, reason: "unavailable" });
    }
    if (!process.env.MODAL_AI_SELFIE_URL) {
      return NextResponse.json({ warmed: false, reason: "not-configured" });
    }

    // Claim the slot BEFORE the awaits below: checked and set across awaits,
    // a room of guests opening the sheet together all passed the check
    // first (review, 2026-10-28). Released on every path that does not ping.
    if (Date.now() < warmingUntil) {
      return NextResponse.json({ warmed: false, reason: "already-warm" });
    }
    warmingUntil = Date.now() + 60_000;
    if (await detectorRecentlyUsed(supabase)) {
      warmingUntil = 0;
      return NextResponse.json({ warmed: false, reason: "already-warm" });
    }
    if (!(await checkAuthRateLimit(supabase, "selfie-warm", slug, clientIp(request)))) {
      warmingUntil = 0;
      return NextResponse.json({ warmed: false, reason: "rate-limited" }, { status: 429 });
    }

    const result = await warmFaceDetector(event.user_id, {
      eventId: share.event_id,
      source: "guest",
    });
    return NextResponse.json({ warmed: result.ok, seconds: result.seconds });
  } catch (error) {
    await reportSystemError("gallery.selfie-warm", error, { slug });
    return NextResponse.json({ warmed: false }, { status: 500 });
  }
}
