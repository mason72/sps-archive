import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";
import { resolveShareImageScope, shareScopeIdFilter } from "@/lib/gallery/share-scope";
import { selfieSearchEnabled } from "@/types/event-settings";
import { matchSelfie } from "@/lib/faces/selfie-match";

export const runtime = "nodejs";

/**
 * POST /api/gallery/[slug]/selfie-search   { imageBase64 }
 *
 * Guest "find my photos": the selfie is forwarded to Modal, embedded in
 * memory, and never stored anywhere — the response is image ids only.
 *
 * Matching goes through CLUSTERING, not just visual similarity: the face
 * hits vote for a person, and the winner's complete photo set comes back —
 * so sunglasses-at-the-party still gets the dance-floor shots. Falls back to
 * direct face hits when no person wins the vote.
 *
 * ON by default per event, enforced here through `selfieSearchEnabled()` —
 * the same predicate the guest payload uses to decide whether to render the
 * button, so the endpoint can never be open behind a hidden button or shut
 * behind a visible one. Same share gates as guest search + a strict rate limit.
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

    // Resolved before the GPU call — an unnarrowable share type can't match
    // anything, so it must not spend the owner's money finding that out.
    const scope = resolveShareImageScope(share);
    if (scope.kind === "none") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!(await checkAuthRateLimit(supabase, "search", slug, clientIp(request)))) {
      return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("user_id, settings")
      .eq("id", share.event_id)
      .single();
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
    // events.user_id is nullable — an ownerless event has no owner scope to
    // search within, so fail closed rather than run the RPC unscoped.
    if (!event.user_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const sharing = ((event.settings ?? {}) as { sharing?: { selfieSearch?: boolean } })
      .sharing;
    if (!selfieSearchEnabled(sharing)) {
      return NextResponse.json({ error: "Selfie search is not enabled" }, { status: 403 });
    }
    if (!process.env.MODAL_AI_SELFIE_URL) {
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const { imageBase64 } = (await request.json()) as { imageBase64?: string };
    if (!imageBase64 || imageBase64.length > 3_000_000) {
      // Client downscales to ~800px before upload; ~2MB base64 is plenty.
      return NextResponse.json({ error: "Bad selfie payload" }, { status: 400 });
    }

    // Matching lives in ONE place, shared with the owner's preview route.
    const match = await matchSelfie(supabase, {
      userId: event.user_id,
      eventId: share.event_id,
      imageBase64,
    });
    if (match.noFace) {
      return NextResponse.json({ results: [], noFace: true });
    }

    // Selection shares expose a subset — intersect server-side; ids only.
    const allowed = shareScopeIdFilter(scope);
    const results = match.imageIds.filter((id) => !allowed || allowed.has(id));

    return NextResponse.json({ results, matchedPerson: match.matchedPerson });
  } catch (error) {
    await reportSystemError("gallery.selfie-search", error, { slug });
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
