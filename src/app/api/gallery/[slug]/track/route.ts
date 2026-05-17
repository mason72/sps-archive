import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity, type ActivityAction } from "@/lib/analytics/log";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/** Actions trackable from the client (subset of ActivityAction). */
const TRACKABLE: ActivityAction[] = ["image_download", "image_view"];

/**
 * POST /api/gallery/[slug]/track — Log client-side engagement events.
 *
 * Used for individual image downloads and image views that happen entirely
 * client-side (presigned R2 URLs). Always returns 204 — never fails.
 *
 * Hardened:
 *  - Per-IP+slug rate limit so a hostile client can't flood the
 *    photographer's activity_log.
 *  - Validates the supplied imageId actually belongs to the share's
 *    event before logging — without this, anyone with the slug could
 *    spam fake image-level rows tied to images they don't own.
 *
 * Body: { action: string, imageId?: string, shareId?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    // 120 events / hour per IP+slug. Generous enough for normal
    // browsing (download tracking happens once per click) but caps
    // log-flooding attempts at a tractable number.
    const limit = rateLimit(
      `track:${clientIp(request)}:${slug}`,
      120,
      60 * 60 * 1000
    );
    if (!limit.success) {
      return new Response(null, { status: 204 });
    }

    const body = await request.json();
    const { action, imageId, shareId } = body as {
      action: string;
      imageId?: string;
      shareId?: string;
    };

    if (!action || !TRACKABLE.includes(action as ActivityAction)) {
      return new Response(null, { status: 204 });
    }

    const supabase = createServiceClient();

    // Resolve slug → share → event → photographer
    const { data: share } = await supabase
      .from("shares")
      .select("id, event_id")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) return new Response(null, { status: 204 });

    // Validate imageId actually belongs to the share's event so a viewer
    // can't spam fake rows tied to cross-event imageIds.
    let validImageId: string | null = null;
    if (imageId && typeof imageId === "string") {
      const { data: img } = await supabase
        .from("images")
        .select("id")
        .eq("id", imageId)
        .eq("event_id", share.event_id)
        .single();
      validImageId = img ? imageId : null;
    }

    const { data: event } = await supabase
      .from("events")
      .select("user_id")
      .eq("id", share.event_id)
      .single();

    if (event?.user_id) {
      logActivity({
        userId: event.user_id,
        action: action as ActivityAction,
        eventId: share.event_id,
        shareId: shareId || share.id,
        imageId: validImageId,
      });
    }

    return new Response(null, { status: 204 });
  } catch {
    // Tracking must never break client UX
    return new Response(null, { status: 204 });
  }
}
