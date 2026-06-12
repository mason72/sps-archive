import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { syncSitePublication } from "@/lib/site/membership";
import { scheduleSiteRevalidate } from "@/lib/site/revalidate";

/**
 * POST /api/images/transfer — copy or move images to a section of ANOTHER
 * gallery.
 *
 * copy: zero-copy — the images are LINKED into the target section
 * (section_images), exactly like website-gallery curation. One shared image;
 * the existing "copies" delete model applies (last copy anywhere = permanent
 * delete). No storage cost.
 *
 * move: full relocation — the images leave their source gallery entirely:
 * every section membership in their OWN event is removed, event_id re-homes
 * to the target gallery (so they join its "All Images" and take its
 * name/city for site captions), and gallery-scoped state (smart stacks) is
 * cleared. Cross-gallery memberships (e.g. TDP Website sections) survive —
 * the image is still the image; only its home changed.
 *
 * Locked sections block on BOTH ends, all-or-nothing: a locked target
 * rejects the transfer, and a move that would rip images out of a locked
 * source section is rejected with the section names (423), mirroring batch
 * delete.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageIds, targetSectionId, mode } = (await request.json()) as {
      imageIds: string[];
      targetSectionId: string;
      mode: "copy" | "move";
    };

    if (!imageIds?.length || !targetSectionId || !["copy", "move"].includes(mode)) {
      return NextResponse.json(
        { error: "imageIds, targetSectionId and mode (copy|move) are required" },
        { status: 400 }
      );
    }
    if (imageIds.length > 500) {
      return NextResponse.json({ error: "Max 500 images per transfer" }, { status: 400 });
    }

    // Target section + its gallery, owner-verified.
    const { data: target } = await supabase
      .from("sections")
      .select("id, name, locked, site_scene_key, event_id, events!event_id(user_id)")
      .eq("id", targetSectionId)
      .maybeSingle();
    const targetOwner = (target?.events as { user_id?: string } | null)?.user_id;
    if (!target || targetOwner !== user!.id) {
      return NextResponse.json({ error: "Target section not found" }, { status: 404 });
    }
    if (target.locked) {
      return NextResponse.json(
        { error: `"${target.name}" is locked — unlock it to receive images.` },
        { status: 423 }
      );
    }

    // Source images, owner-verified.
    const { data: images } = await supabase
      .from("images")
      .select("id, event_id, site_published_at, events!event_id(user_id)")
      .in("id", imageIds);
    const owned = (images ?? []).filter(
      (img) => (img.events as { user_id?: string } | null)?.user_id === user!.id
    );
    if (owned.length === 0) {
      return NextResponse.json({ error: "No accessible images found" }, { status: 404 });
    }
    const ownedIds = owned.map((img) => img.id);

    if (mode === "move") {
      // A move unlinks every membership in each image's OWN gallery. If any
      // of those sections are locked, block the whole transfer with names —
      // exactly the inadvertent edit locks exist to prevent.
      const sourceEventIds = [...new Set(owned.map((img) => img.event_id))];
      const { data: sourceLinks, error: linksError } = await supabase
        .from("section_images")
        .select("image_id, section_id, sections!inner(name, locked, event_id)")
        .in("image_id", ownedIds)
        .in("sections.event_id", sourceEventIds);
      if (linksError) throw linksError;

      const links = (sourceLinks ?? []) as unknown as Array<{
        image_id: string;
        section_id: string;
        sections: { name: string; locked: boolean | null; event_id: string };
      }>;
      // Only links within the image's own event count as "source" links.
      const eventByImage = new Map(owned.map((img) => [img.id, img.event_id]));
      const homeLinks = links.filter(
        (l) => l.sections.event_id === eventByImage.get(l.image_id)
      );

      const lockedNames = [
        ...new Set(
          homeLinks.filter((l) => l.sections.locked).map((l) => l.sections.name)
        ),
      ];
      if (lockedNames.length > 0) {
        return NextResponse.json(
          {
            error: `Nothing moved — images live in locked ${
              lockedNames.length === 1 ? "section" : "sections"
            } ${lockedNames.map((n) => `"${n}"`).join(", ")}. Unlock to move.`,
          },
          { status: 423 }
        );
      }

      // Unlink from every home-gallery section.
      for (const sectionId of [...new Set(homeLinks.map((l) => l.section_id))]) {
        const idsInSection = homeLinks
          .filter((l) => l.section_id === sectionId)
          .map((l) => l.image_id);
        const { error } = await supabase
          .from("section_images")
          .delete()
          .eq("section_id", sectionId)
          .in("image_id", idsInSection);
        if (error) throw error;
      }

      // Re-home: new gallery, and gallery-scoped stack state cleared.
      const { error: updateError } = await supabase
        .from("images")
        .update({ event_id: target.event_id, stack_id: null, stack_rank: null })
        .in("id", ownedIds);
      if (updateError) throw updateError;
    }

    // Link into the target section (append to its drag order). Upsert so a
    // re-copy of an existing member is a no-op, not an error.
    const { data: existing } = await supabase
      .from("section_images")
      .select("sort_order")
      .eq("section_id", target.id)
      .order("sort_order", { ascending: false })
      .limit(1);
    let nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

    const { error: linkError } = await supabase.from("section_images").upsert(
      ownedIds.map((imageId) => ({
        section_id: target.id,
        image_id: imageId,
        sort_order: nextOrder++,
      })),
      { onConflict: "section_id,image_id" }
    );
    if (linkError) throw linkError;

    // Site bookkeeping: joining a website section publishes (membership =
    // publication); moved-and-published images need a caption refresh even
    // when membership didn't change (the source event's name/city did).
    if (target.site_scene_key) {
      await syncSitePublication(supabase, ownedIds);
    } else if (mode === "move" && owned.some((img) => img.site_published_at)) {
      scheduleSiteRevalidate();
    }

    return NextResponse.json({
      transferred: ownedIds.length,
      mode,
      targetSectionId: target.id,
      targetEventId: target.event_id,
    });
  } catch (error) {
    console.error("Transfer error:", error);
    return NextResponse.json(
      { error: "Failed to transfer images" },
      { status: 500 }
    );
  }
}
