import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";

/**
 * GET /api/gallery/[slug]/cover
 *
 * Stable, non-expiring URL for a gallery's cover image — built for email.
 * Presigned R2 URLs live hours; emails get opened days later. This route is
 * the durable address: each hit 302s to a fresh presigned thumbnail.
 *
 * Access control matches the email's own gallery link: the slug IS the
 * credential. The redirect dies with the share (deactivated/expired → 404/410),
 * and it serves only the single designated cover image — never the grid. The
 * password gate is intentionally NOT enforced here: the cover is the hero of
 * an email the photographer chose to send.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const supabase = createServiceClient();

    const { data: share } = await supabase
      .from("shares")
      .select("event_id, expires_at")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("settings")
      .eq("id", share.event_id)
      .single();

    const settings = (event?.settings ?? {}) as Record<string, unknown>;
    const cover = (settings.cover ?? {}) as { imageId?: string };
    if (!cover.imageId) {
      return NextResponse.json({ error: "No cover image" }, { status: 404 });
    }

    const { data: image } = await supabase
      .from("images")
      .select("r2_key")
      .eq("id", cover.imageId)
      .eq("event_id", share.event_id)
      .single();

    if (!image) {
      return NextResponse.json({ error: "No cover image" }, { status: 404 });
    }

    // 800px JPEG thumbnail — right size for a 560px-wide email card.
    const url = await getPresignedDownloadUrl(
      getThumbnailKey(image.r2_key, "thumb-lg"),
      3600
    );

    return NextResponse.redirect(url, {
      status: 302,
      // Cacheable briefly so email-client image proxies don't hammer us, but
      // well under the presign's 1h validity.
      headers: { "Cache-Control": "public, max-age=900" },
    });
  } catch (error) {
    console.error("Gallery cover error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
