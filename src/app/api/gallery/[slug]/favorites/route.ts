import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/analytics/log";

/**
 * POST /api/gallery/[slug]/favorites — Add a favorite.
 * Public endpoint — uses service client.
 *
 * Body: { imageId: string, shareId: string, clientName?: string, clientEmail?: string }
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

    // Verify share is active and allows favorites
    const { data: share, error: shareError } = await supabase
      .from("shares")
      .select("id, allow_favorites, event_id")
      .eq("id", shareId)
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (shareError || !share || !share.allow_favorites) {
      return NextResponse.json(
        { error: "Favorites not available for this gallery" },
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
          client_name: clientName || null,
          client_email: clientEmail || null,
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
      } catch {
        /* fire and forget */
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
 * GET /api/gallery/[slug]/favorites?shareId=<id> — List favorites for a share.
 * Public endpoint — returns image IDs.
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

    const { data, error } = await supabase
      .from("favorites")
      .select("image_id, client_name, client_email, created_at")
      .eq("share_id", shareId);

    if (error) throw error;

    return NextResponse.json({
      favorites: (data || []).map((f) => ({
        imageId: f.image_id,
        clientName: f.client_name,
        clientEmail: f.client_email,
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
 * DELETE /api/gallery/[slug]/favorites — Remove a favorite.
 * Public endpoint.
 *
 * Body: { imageId: string, shareId: string }
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

    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("share_id", shareId)
      .eq("image_id", imageId);

    if (error) throw error;

    // Log unfavorite (fire and forget — single join instead of 2 queries)
    (async () => {
      try {
        const { data: s } = await supabase
          .from("shares")
          .select("event_id, events!inner(user_id)")
          .eq("id", shareId)
          .single();
        const evt = s?.events as unknown as { user_id: string } | null;
        if (evt?.user_id) {
          logActivity({
            userId: evt.user_id,
            action: "image_unfavorite",
            eventId: s!.event_id,
            shareId: shareId,
            imageId: imageId,
          });
        }
      } catch {
        /* fire and forget */
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
