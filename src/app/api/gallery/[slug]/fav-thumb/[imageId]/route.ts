import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";

/**
 * GET /api/gallery/[slug]/fav-thumb/[imageId]
 *
 * Durable thumbnail URL for the favorites-digest email's preview strip (same
 * pattern as /cover: emails outlive presigns, so each open 302s to a fresh
 * one). Serves ONLY images that are actually favorited on this share — the
 * favorite row is the authorization — and dies with the share.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string; imageId: string }> }
) {
  try {
    const { slug, imageId } = await params;
    const supabase = createServiceClient();

    const { data: share } = await supabase
      .from("shares")
      .select("id, expires_at")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }

    const { data: favorite } = await supabase
      .from("favorites")
      .select("image_id, images!inner(r2_key)")
      .eq("share_id", share.id)
      .eq("image_id", imageId)
      .single();

    const image = favorite?.images as unknown as { r2_key: string } | null;
    if (!image) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const url = await getPresignedDownloadUrl(
      getThumbnailKey(image.r2_key, "thumb-md"),
      3600
    );

    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "public, max-age=900" },
    });
  } catch (error) {
    console.error("Favorite thumb error:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
