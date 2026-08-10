import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resolveShareCoverUrl } from "@/lib/cover/resolve-share-cover";

/**
 * GET /api/gallery/[slug]/cover
 *
 * Stable, non-expiring URL for a gallery's cover image — built for email.
 * Presigned R2 URLs live hours; emails get opened days later. This route is
 * the durable address: each hit 302s to a fresh presigned thumbnail.
 *
 * Access control matches the email's own gallery link: the slug IS the
 * credential. The redirect dies with the share (deactivated/expired → 404/410),
 * and it serves only a single cover frame — never the grid. The password gate
 * is intentionally NOT enforced here: the cover is the hero of an email the
 * photographer chose to send.
 *
 * Which frame that is lives in resolveShareCoverUrl, shared with the email
 * composer so the two can't disagree about whether a hero exists.
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
      .select("event_id, expires_at, share_type, image_ids")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }

    const url = await resolveShareCoverUrl(share, 3600);
    if (!url) {
      return NextResponse.json({ error: "No cover image" }, { status: 404 });
    }

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
