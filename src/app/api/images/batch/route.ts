import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { deleteFromR2 } from "@/lib/r2/client";

/** DELETE /api/images/batch — Delete multiple images */
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageIds } = (await request.json()) as { imageIds: string[] };

    if (!imageIds?.length) {
      return NextResponse.json({ error: "imageIds required" }, { status: 400 });
    }

    if (imageIds.length > 500) {
      return NextResponse.json({ error: "Max 500 images per batch" }, { status: 400 });
    }

    // Fetch images to verify ownership and get R2 keys
    const { data: images, error: fetchError } = await supabase
      .from("images")
      .select("id, r2_key, event_id, events!event_id(user_id)")
      .in("id", imageIds);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    // Filter to only images owned by this user
    const ownedImages = (images || []).filter(
      (img: Record<string, unknown>) => {
        const events = img.events as Record<string, unknown> | null;
        return events && events.user_id === user!.id;
      }
    );

    if (ownedImages.length === 0) {
      return NextResponse.json({ error: "No accessible images found" }, { status: 404 });
    }

    // Delete from DB
    const ownedIds = ownedImages.map((img: Record<string, unknown>) => img.id as string);
    const { error: deleteError } = await supabase
      .from("images")
      .delete()
      .in("id", ownedIds);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Delete from R2 (fire-and-forget, don't block response)
    Promise.all(
      ownedImages.map((img: Record<string, unknown>) =>
        deleteFromR2(img.r2_key as string).catch((err) =>
          console.error("R2 delete failed for", img.r2_key, err)
        )
      )
    );

    return NextResponse.json({
      deleted: ownedIds.length,
      message: `Deleted ${ownedIds.length} images`,
    });
  } catch (error) {
    console.error("Batch delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete images" },
      { status: 500 }
    );
  }
}

/** PATCH /api/images/batch — Batch operations on images */
export async function PATCH(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = (await request.json()) as {
      imageIds: string[];
      action: "add_to_section" | "remove_from_section" | "favorite";
      sectionId?: string;
      shareId?: string;
    };

    const { imageIds, action, sectionId, shareId } = body;

    if (!imageIds?.length || !action) {
      return NextResponse.json(
        { error: "imageIds and action required" },
        { status: 400 }
      );
    }

    // Verify ownership: check that images belong to user's events
    const { data: images } = await supabase
      .from("images")
      .select("id, event_id, events!event_id(user_id)")
      .in("id", imageIds);

    const ownedIds = (images || [])
      .filter((img: Record<string, unknown>) => {
        const events = img.events as Record<string, unknown> | null;
        return events && events.user_id === user!.id;
      })
      .map((img: Record<string, unknown>) => img.id as string);

    if (ownedIds.length === 0) {
      return NextResponse.json({ error: "No accessible images" }, { status: 404 });
    }

    switch (action) {
      case "add_to_section": {
        if (!sectionId) {
          return NextResponse.json({ error: "sectionId required" }, { status: 400 });
        }

        // Get current max sort_order
        const { data: existing } = await supabase
          .from("section_images")
          .select("sort_order")
          .eq("section_id", sectionId)
          .order("sort_order", { ascending: false })
          .limit(1);

        let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

        // Insert images into section (upsert to avoid duplicates)
        const rows = ownedIds.map((imageId) => ({
          section_id: sectionId,
          image_id: imageId,
          sort_order: nextOrder++,
        }));

        const { error } = await supabase
          .from("section_images")
          .upsert(rows, { onConflict: "section_id,image_id" });

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ updated: ownedIds.length, action });
      }

      case "remove_from_section": {
        if (!sectionId) {
          return NextResponse.json({ error: "sectionId required" }, { status: 400 });
        }

        const { error } = await supabase
          .from("section_images")
          .delete()
          .eq("section_id", sectionId)
          .in("image_id", ownedIds);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ updated: ownedIds.length, action });
      }

      case "favorite": {
        if (!shareId) {
          return NextResponse.json({ error: "shareId required" }, { status: 400 });
        }

        // Verify the share belongs to the user and is active
        const { data: share, error: shareError } = await supabase
          .from("shares")
          .select("id, event_id")
          .eq("id", shareId)
          .eq("is_active", true)
          .single();

        if (shareError || !share) {
          return NextResponse.json({ error: "Share not found" }, { status: 404 });
        }

        // Upsert favorites for each image (photographer adding on behalf of client)
        // Use a sentinel email so the unique constraint (share_id, image_id, client_email)
        // properly deduplicates — NULL values are treated as distinct in Postgres.
        const PHOTOGRAPHER_EMAIL = "photographer@prism.internal";
        const rows = ownedIds.map((imageId) => ({
          share_id: shareId,
          image_id: imageId,
          client_name: "Photographer Pick",
          client_email: PHOTOGRAPHER_EMAIL,
        }));

        const { error: favError } = await supabase
          .from("favorites")
          .upsert(rows, { onConflict: "share_id,image_id,client_email" });

        if (favError) {
          return NextResponse.json({ error: favError.message }, { status: 500 });
        }

        return NextResponse.json({ updated: ownedIds.length, action });
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Batch operation error:", error);
    return NextResponse.json(
      { error: "Failed to perform batch operation" },
      { status: 500 }
    );
  }
}
