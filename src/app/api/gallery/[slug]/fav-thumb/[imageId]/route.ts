import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { resolveShareImageScope, shareScopeIdFilter } from "@/lib/gallery/share-scope";

/**
 * GET /api/gallery/[slug]/fav-thumb/[imageId]
 *
 * Durable thumbnail URL for the favorites-digest email's preview strip (same
 * pattern as /cover: emails outlive presigns, so each open 302s to a fresh
 * one). Serves ONLY images that are actually favorited on this share — and
 * that the share's own scope exposes — and dies with the share.
 *
 * The scope check is what makes this route safe to reason about alone. A
 * favorite row is DERIVED state with more than one writer (the guest endpoint
 * and the photographer's "Pick" in /api/images/batch), so "a row exists"
 * cannot be the whole authorization: a pick made outside a selection share's
 * curation would otherwise hand its thumbnail to anyone holding the slug.
 * Guard the reader, because the reader is what serves the pixels.
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
      .select("id, expires_at, share_type, image_ids")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (!share) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (share.expires_at && new Date(share.expires_at) < new Date()) {
      return NextResponse.json({ error: "Expired" }, { status: 410 });
    }

    const allowed = shareScopeIdFilter(resolveShareImageScope(share));
    if (allowed && !allowed.has(imageId)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
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
