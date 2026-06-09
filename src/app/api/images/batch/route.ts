import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { deleteFromR2 } from "@/lib/r2/client";
import { isValidScene, deriveServiceFromScene } from "@/lib/site/scenes";
import { publishImageToLane, unpublishImageFromLane } from "@/lib/site/publish";

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
      action: "add_to_section" | "remove_from_section" | "favorite" | "rename" | "set_scene";
      sectionId?: string;
      shareId?: string;
      pattern?: string;
      /** Scene key for set_scene; null/"" un-tags (removes from the public lane). */
      scene?: string | null;
    };

    const { imageIds, action, sectionId, shareId, pattern, scene } = body;

    if (!imageIds?.length || !action) {
      return NextResponse.json(
        { error: "imageIds and action required" },
        { status: 400 }
      );
    }

    // Verify ownership: check that images belong to user's events. r2_key is
    // needed by set_scene to mirror variants into the public lane.
    const { data: images } = await supabase
      .from("images")
      .select("id, r2_key, event_id, events!event_id(user_id)")
      .in("id", imageIds);

    const ownedImages = (images || []).filter((img: Record<string, unknown>) => {
      const events = img.events as Record<string, unknown> | null;
      return events && events.user_id === user!.id;
    });
    const ownedIds = ownedImages.map((img: Record<string, unknown>) => img.id as string);

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
        const PHOTOGRAPHER_EMAIL = "photographer@pixeltrunk.internal";
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

      case "rename": {
        if (!pattern) {
          return NextResponse.json({ error: "pattern required" }, { status: 400 });
        }

        // Generate new filenames based on the pattern
        // {N} → zero-padded (001, 002, ...), {n} → plain (1, 2, ...)
        const updates = ownedIds.map((imageId, index) => {
          const num = index + 1;
          const padded = String(num).padStart(3, "0");
          const newName = pattern
            .replace(/\{N\}/g, padded)
            .replace(/\{n\}/g, String(num));

          return supabase
            .from("images")
            .update({ original_filename: newName })
            .eq("id", imageId);
        });

        const results = await Promise.all(updates);
        const failed = results.filter((r) => r.error);
        if (failed.length > 0) {
          console.error("Some renames failed:", failed.map((r) => r.error));
        }

        return NextResponse.json({
          updated: ownedIds.length - failed.length,
          action,
        });
      }

      case "set_scene": {
        // Tag (or un-tag) images into a website scene. Tagging publishes the
        // image's public variants to the marketing lane (sps-public); un-tagging
        // (scene null/empty) removes them. Private galleries are untouched.
        const targetScene = scene?.trim() || null;
        if (targetScene && !isValidScene(targetScene)) {
          return NextResponse.json(
            { error: `Unknown scene: ${targetScene}` },
            { status: 400 }
          );
        }

        if (targetScene) {
          // Mirror variants into the public lane first; only mark published rows.
          const derivedService = deriveServiceFromScene(targetScene);
          const publishedAt = new Date().toISOString();
          const failed: string[] = [];

          await Promise.all(
            ownedImages.map(async (img: Record<string, unknown>) => {
              const id = img.id as string;
              const r2Key = img.r2_key as string;
              try {
                await publishImageToLane(r2Key);
                const update: Record<string, unknown> = {
                  site_scene: targetScene,
                  site_published_at: publishedAt,
                };
                // Auto-fill service from service/* scenes; never overwrite an
                // existing manual service with null.
                if (derivedService) update.service = derivedService;
                await supabase.from("images").update(update).eq("id", id);
              } catch (err) {
                console.error("Publish to public lane failed for", r2Key, err);
                failed.push(id);
              }
            })
          );

          return NextResponse.json({
            updated: ownedIds.length - failed.length,
            failed: failed.length,
            action,
            scene: targetScene,
          });
        }

        // Un-tag: clear scene fields, then best-effort remove from the lane.
        const { error } = await supabase
          .from("images")
          .update({ site_scene: null, site_published_at: null })
          .in("id", ownedIds);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        await Promise.all(
          ownedImages.map((img: Record<string, unknown>) =>
            unpublishImageFromLane(img.r2_key as string).catch((err) =>
              console.error("Unpublish from public lane failed for", img.r2_key, err)
            )
          )
        );

        return NextResponse.json({ updated: ownedIds.length, action, scene: null });
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
