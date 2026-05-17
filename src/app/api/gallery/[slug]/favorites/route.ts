import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/analytics/log";

/**
 * Resolve the slug → share, verifying it's active. Returns null on any
 * mismatch. Centralizes the slug/share_id binding so favorites endpoints
 * can never act on a shareId that doesn't match the URL slug.
 */
async function getShareForFavorites(
  supabase: ReturnType<typeof createServiceClient>,
  slug: string,
  shareId: string
) {
  const { data: share } = await supabase
    .from("shares")
    .select("id, allow_favorites, event_id, share_type, image_ids, section_id, person_id, expires_at, is_active")
    .eq("id", shareId)
    .eq("slug", slug)
    .eq("is_active", true)
    .single();

  if (!share) return null;
  if (share.expires_at && new Date(share.expires_at) < new Date()) return null;
  return share;
}

/**
 * Check that imageId is in scope for this share — both that the image
 * belongs to the share's event AND, for non-full shares, that it's in the
 * selection/section/person subset. Without this, a client on a section
 * share could favorite arbitrary images from elsewhere in the event.
 */
async function imageIsInShare(
  supabase: ReturnType<typeof createServiceClient>,
  share: { event_id: string; share_type: string | null; image_ids: string[] | null; section_id: string | null; person_id: string | null },
  imageId: string
): Promise<boolean> {
  // Belongs to event?
  const { data: img } = await supabase
    .from("images")
    .select("id")
    .eq("id", imageId)
    .eq("event_id", share.event_id)
    .single();
  if (!img) return false;

  switch (share.share_type) {
    case "full":
    case null:
    case undefined:
      return true;
    case "selection":
      return (share.image_ids ?? []).includes(imageId);
    case "section": {
      if (!share.section_id) return false;
      const { data } = await supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", share.section_id)
        .eq("image_id", imageId)
        .single();
      return !!data;
    }
    case "person": {
      if (!share.person_id) return false;
      const { data } = await supabase
        .from("faces")
        .select("image_id")
        .eq("person_id", share.person_id)
        .eq("image_id", imageId)
        .limit(1)
        .maybeSingle();
      return !!data;
    }
    default:
      return false;
  }
}

/**
 * POST /api/gallery/[slug]/favorites — add a favorite. Verifies that
 * shareId binds to the slug, that favorites are allowed, and that the
 * image is in scope for the share.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const { imageId, shareId, clientName, clientEmail } = body as {
      imageId: string;
      shareId: string;
      clientName?: string;
      clientEmail?: string;
    };

    if (!imageId || !shareId) {
      return NextResponse.json(
        { error: "imageId and shareId are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const share = await getShareForFavorites(supabase, slug, shareId);
    if (!share || !share.allow_favorites) {
      return NextResponse.json(
        { error: "Favorites not available for this gallery" },
        { status: 403 }
      );
    }

    if (!(await imageIsInShare(supabase, share, imageId))) {
      return NextResponse.json(
        { error: "Image is not part of this gallery" },
        { status: 403 }
      );
    }

    // Upsert favorite (don't duplicate)
    const { data, error } = await supabase
      .from("favorites")
      .upsert(
        {
          share_id: shareId,
          image_id: imageId,
          client_name: clientName?.slice(0, 120) || null,
          client_email: clientEmail?.slice(0, 320) || null,
        },
        { onConflict: "share_id,image_id" }
      )
      .select()
      .single();

    if (error) throw error;

    // Log favorite (fire and forget — look up photographer)
    (async () => {
      try {
        const { data: evt } = await supabase
          .from("events")
          .select("user_id")
          .eq("id", share.event_id)
          .single();
        if (evt?.user_id) {
          logActivity({
            userId: evt.user_id,
            action: "image_favorite",
            eventId: share.event_id,
            shareId: shareId,
            imageId: imageId,
          });
        }
      } catch (err) {
        console.error("[favorites POST] activity log failed:", err);
      }
    })();

    return NextResponse.json({ favorite: data }, { status: 201 });
  } catch (error) {
    console.error("Add favorite error:", error);
    return NextResponse.json(
      { error: "Failed to add favorite" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/gallery/[slug]/favorites?shareId=<id>
 *
 * Public endpoint. Returns only image IDs — never client_name / client_email,
 * since multiple clients may share the same link and we don't want one to
 * scrape another's contact info. The photographer reads names + emails via
 * the authenticated /api/events/[eventId]/favorites route.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const shareId = searchParams.get("shareId");

    if (!shareId) {
      return NextResponse.json(
        { error: "shareId is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const share = await getShareForFavorites(supabase, slug, shareId);
    if (!share) {
      return NextResponse.json({ favorites: [] });
    }

    const { data, error } = await supabase
      .from("favorites")
      .select("image_id, created_at")
      .eq("share_id", shareId);

    if (error) throw error;

    return NextResponse.json({
      favorites: (data || []).map((f) => ({
        imageId: f.image_id,
        createdAt: f.created_at,
      })),
    });
  } catch (error) {
    console.error("List favorites error:", error);
    return NextResponse.json(
      { error: "Failed to list favorites" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/gallery/[slug]/favorites — remove a favorite. Same slug/share
 * binding as POST.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await request.json();
    const { imageId, shareId } = body as {
      imageId: string;
      shareId: string;
    };

    if (!imageId || !shareId) {
      return NextResponse.json(
        { error: "imageId and shareId are required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const share = await getShareForFavorites(supabase, slug, shareId);
    if (!share) {
      return NextResponse.json(
        { error: "Gallery not found" },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("share_id", shareId)
      .eq("image_id", imageId);

    if (error) throw error;

    // Log unfavorite (fire and forget)
    (async () => {
      try {
        const { data: evt } = await supabase
          .from("events")
          .select("user_id")
          .eq("id", share.event_id)
          .single();
        if (evt?.user_id) {
          logActivity({
            userId: evt.user_id,
            action: "image_unfavorite",
            eventId: share.event_id,
            shareId: shareId,
            imageId: imageId,
          });
        }
      } catch (err) {
        console.error("[favorites DELETE] activity log failed:", err);
      }
    })();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Remove favorite error:", error);
    return NextResponse.json(
      { error: "Failed to remove favorite" },
      { status: 500 }
    );
  }
}
