import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity, type ActivityAction } from "@/lib/analytics/log";

/** Actions trackable from the client (subset of ActivityAction). */
const TRACKABLE: ActivityAction[] = ["image_download", "image_view"];

/**
 * POST /api/gallery/[slug]/track — Log client-side engagement events.
 *
 * Used for individual image downloads and image views that happen entirely
 * client-side (presigned R2 URLs). Always returns 204 — never fails.
 *
 * Body: { action: string, imageId?: string, shareId?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
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
        imageId: imageId || null,
      });
    }

    return new Response(null, { status: 204 });
  } catch {
    // Tracking must never break client UX
    return new Response(null, { status: 204 });
  }
}
