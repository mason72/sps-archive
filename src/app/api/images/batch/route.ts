import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { deleteImageAssets } from "@/lib/r2/client";
import { unpublishAssetFromLane } from "@/lib/site/publish";
import { syncSitePublication } from "@/lib/site/membership";
import { partitionSectionDelete } from "@/lib/gallery/delete-partition";
import { mediaExtension, stripMediaExtension } from "@/lib/upload/media";

/**
 * DELETE /api/images/batch — Delete multiple images.
 *
 * With `sectionId` (a section is open in the editor), delete follows the
 * "copies" mental model: an image that also lives in OTHER sections only
 * loses its copy in this one; an image in its LAST section is deleted for
 * real. Without `sectionId` ("All Images", search), delete is always
 * permanent.
 */
export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageIds, sectionId } = (await request.json()) as {
      imageIds: string[];
      sectionId?: string;
    };

    if (!imageIds?.length) {
      return NextResponse.json({ error: "imageIds required" }, { status: 400 });
    }

    if (imageIds.length > 500) {
      return NextResponse.json({ error: "Max 500 images per batch" }, { status: 400 });
    }

    // Fetch images to verify ownership and get R2 keys. site_published_at
    // tells us which ones also have public marketing-lane copies to clean up.
    const { data: images, error: fetchError } = await supabase
      .from("images")
      .select(
        "id, r2_key, event_id, site_published_at, media_type, duration_seconds, has_audio, stream_uid, events!event_id(user_id)"
      )
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

    const ownedIds = ownedImages.map((img: Record<string, unknown>) => img.id as string);

    // Partition by section context: unlink images that have copies elsewhere,
    // hard-delete the rest. Membership is counted across ALL sections of ALL
    // events — a photo in a client-event section AND a website section has two
    // copies, even though the editor only shows this event's memberships.
    let removeOnlyIds: string[] = [];
    let hardDeleteIds = ownedIds;
    if (sectionId) {
      const { data: section } = await supabase
        .from("sections")
        .select("id, name, site_scene_key, locked, events!event_id(user_id)")
        .eq("id", sectionId)
        .maybeSingle();
      const sectionOwner = (section?.events as { user_id?: string } | null)
        ?.user_id;
      if (!section || sectionOwner !== user!.id) {
        return NextResponse.json({ error: "Section not found" }, { status: 404 });
      }

      if (section.locked) {
        return NextResponse.json(
          { error: `"${section.name}" is locked — unlock it to remove or delete photos.` },
          { status: 423 }
        );
      }

      const membershipCounts = new Map<string, number>();
      const currentSectionMembers = new Set<string>();
      const PAGE_SIZE = 1000;
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: links, error: linksError } = await supabase
          .from("section_images")
          .select("image_id, section_id")
          .in("image_id", ownedIds)
          .order("image_id", { ascending: true })
          .order("section_id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (linksError) throw linksError;
        if (!links || links.length === 0) break;
        for (const link of links) {
          membershipCounts.set(
            link.image_id,
            (membershipCounts.get(link.image_id) ?? 0) + 1
          );
          if (link.section_id === sectionId) {
            currentSectionMembers.add(link.image_id);
          }
        }
        if (links.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }

      const partition = partitionSectionDelete(
        ownedIds,
        membershipCounts,
        currentSectionMembers
      );
      removeOnlyIds = partition.removeFromSection;
      hardDeleteIds = partition.hardDelete;
    }

    // Hard deletes would also rip images out of any LOCKED section they live
    // in (membership cascades with the row) — exactly the inadvertent edit
    // locks exist to stop. All-or-nothing: block the whole request with the
    // section names so the user can unlock deliberately.
    if (hardDeleteIds.length > 0) {
      const { data: lockedLinks } = await supabase
        .from("section_images")
        .select("image_id, sections!inner(name, locked)")
        .in("image_id", hardDeleteIds)
        .eq("sections.locked", true);
      if (lockedLinks && lockedLinks.length > 0) {
        const names = [
          ...new Set(
            (lockedLinks as unknown as { sections: { name: string } }[]).map(
              (l) => l.sections.name
            )
          ),
        ];
        return NextResponse.json(
          {
            error: `Nothing deleted — ${lockedLinks.length === 1 ? "a photo lives" : "photos live"} in locked ${
              names.length === 1 ? "section" : "sections"
            } ${names.map((n) => `"${n}"`).join(", ")}. Unlock to delete.`,
          },
          { status: 423 }
        );
      }
    }

    // 1. Unlink the section copies; if this was a website section the sync
    // unpublishes images that just left their last website membership.
    if (removeOnlyIds.length > 0) {
      const { error: unlinkError } = await supabase
        .from("section_images")
        .delete()
        .eq("section_id", sectionId!)
        .in("image_id", removeOnlyIds);
      if (unlinkError) {
        return NextResponse.json({ error: unlinkError.message }, { status: 500 });
      }
      await syncSitePublication(supabase, removeOnlyIds);
    }

    // 2. Hard-delete the last copies.
    if (hardDeleteIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("images")
        .delete()
        .in("id", hardDeleteIds);

      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }

      // Delete from R2 (fire-and-forget, don't block response). Published
      // images also have public copies in the marketing lane — v1 leaked
      // those on delete; remove them too.
      const hardDeleteSet = new Set(hardDeleteIds);
      Promise.all(
        ownedImages
          .filter((img: Record<string, unknown>) =>
            hardDeleteSet.has(img.id as string)
          )
          .map(async (img: Record<string, unknown>) => {
            const r2Key = img.r2_key as string;
            // Original + all thumbnail variants (+ video rendition) — deleting
            // just the original used to strand the 3 derivatives forever.
            await deleteImageAssets(r2Key, img.media_type as string | null);
            if (img.site_published_at) {
              await unpublishAssetFromLane({
                r2Key,
                mediaType: (img.media_type as string) ?? "image",
                durationSeconds: (img.duration_seconds as number | null) ?? null,
                hasAudio: (img.has_audio as boolean | null) ?? null,
                streamUid: (img.stream_uid as string | null) ?? null,
              }).catch((err) =>
                console.error("Public lane delete failed for", r2Key, err)
              );
            }
          })
      );
    }

    return NextResponse.json({
      deleted: hardDeleteIds.length,
      removedFromSection: removeOnlyIds.length,
      message:
        removeOnlyIds.length > 0
          ? `Removed ${removeOnlyIds.length} from the section, deleted ${hardDeleteIds.length}`
          : `Deleted ${hardDeleteIds.length} images`,
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
      action: "add_to_section" | "remove_from_section" | "favorite" | "rename";
      sectionId?: string;
      shareId?: string;
      pattern?: string;
    };

    const { imageIds, action, sectionId, shareId, pattern } = body;

    if (!imageIds?.length || !action) {
      return NextResponse.json(
        { error: "imageIds and action required" },
        { status: 400 }
      );
    }

    // Same cap the DELETE handler enforces — bound the IN-list size.
    if (imageIds.length > 500) {
      return NextResponse.json(
        { error: "Max 500 images per batch" },
        { status: 400 }
      );
    }

    // Verify ownership: check that images belong to user's events. `filename`
    // (the storage name, always "{uuid}.{ext}") is the reliable source of each
    // image's true extension for rename.
    const { data: images } = await supabase
      .from("images")
      .select("id, event_id, filename, events!event_id(user_id)")
      .in("id", imageIds);

    const ownedImages = (images || []).filter((img: Record<string, unknown>) => {
      const events = img.events as Record<string, unknown> | null;
      return events && events.user_id === user!.id;
    });
    const ownedIds = ownedImages.map((img: Record<string, unknown>) => img.id as string);
    const filenameById = new Map(
      ownedImages.map((img: Record<string, unknown>) => [
        img.id as string,
        (img.filename as string) ?? "",
      ])
    );

    if (ownedIds.length === 0) {
      return NextResponse.json({ error: "No accessible images" }, { status: 404 });
    }

    switch (action) {
      case "add_to_section": {
        if (!sectionId) {
          return NextResponse.json({ error: "sectionId required" }, { status: 400 });
        }

        // Adding into a website section publishes by membership. The target
        // section MUST belong to the caller — otherwise a user could add their
        // images into another tenant's section and, if it feeds the marketing
        // site (site_scene_key), publish them onto the victim's public site.
        const { data: targetSection } = await supabase
          .from("sections")
          .select("name, site_scene_key, locked, events!event_id!inner(user_id)")
          .eq("id", sectionId)
          .eq("events.user_id", user!.id)
          .maybeSingle();

        if (!targetSection) {
          return NextResponse.json({ error: "Section not found" }, { status: 404 });
        }
        if (targetSection.locked) {
          return NextResponse.json(
            { error: `"${targetSection.name}" is locked — unlock it to add images.` },
            { status: 423 }
          );
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

        if (targetSection?.site_scene_key) {
          await syncSitePublication(supabase, ownedIds);
        }

        return NextResponse.json({ updated: ownedIds.length, action });
      }

      case "remove_from_section": {
        if (!sectionId) {
          return NextResponse.json({ error: "sectionId required" }, { status: 400 });
        }

        const { data: sourceSection } = await supabase
          .from("sections")
          .select("name, site_scene_key, locked, events!event_id!inner(user_id)")
          .eq("id", sectionId)
          .eq("events.user_id", user!.id)
          .maybeSingle();

        if (!sourceSection) {
          return NextResponse.json({ error: "Section not found" }, { status: 404 });
        }
        if (sourceSection.locked) {
          return NextResponse.json(
            { error: `"${sourceSection.name}" is locked — unlock it to remove images.` },
            { status: 423 }
          );
        }

        const { error } = await supabase
          .from("section_images")
          .delete()
          .eq("section_id", sectionId)
          .in("image_id", ownedIds);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Leaving a website section may unpublish (sync re-checks remaining
        // website membership before deleting public copies).
        if (sourceSection?.site_scene_key) {
          await syncSitePublication(supabase, ownedIds);
        }

        return NextResponse.json({ updated: ownedIds.length, action });
      }

      case "favorite": {
        if (!shareId) {
          return NextResponse.json({ error: "shareId required" }, { status: 400 });
        }

        // Verify the share belongs to the caller (via its event) and is active
        // — the join is the ownership check the old comment claimed but the
        // code lacked, so a user couldn't attach "Photographer Pick" rows to
        // another tenant's share.
        const { data: share, error: shareError } = await supabase
          .from("shares")
          .select("id, event_id, events!event_id!inner(user_id)")
          .eq("id", shareId)
          .eq("is_active", true)
          .eq("events.user_id", user!.id)
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

        // Generate new filenames from the pattern.
        // {N} → zero-padded (001, 002, ...), {n} → plain (1, 2, ...).
        // The original extension is ALWAYS preserved per image (the user names
        // files without one) — strip any extension they typed anyway, then
        // re-append the image's real one from its storage filename.
        const updates = ownedIds.map((imageId, index) => {
          const num = index + 1;
          const padded = String(num).padStart(3, "0");
          const base = stripMediaExtension(
            pattern.replace(/\{N\}/g, padded).replace(/\{n\}/g, String(num))
          );
          const ext = mediaExtension(filenameById.get(imageId) ?? "");
          const newName = ext ? `${base}.${ext}` : base;

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

      // "set_scene" (v1 per-image website tagging) was retired in favor of the
      // TDP Website gallery — see POST/DELETE /api/site/gallery.

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
