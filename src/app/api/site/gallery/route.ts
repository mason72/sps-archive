import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { isValidScene, sceneForKey } from "@/lib/site/scenes";
import { getWebsiteSection, WEBSITE_EVENT_SLUG } from "@/lib/site/gallery";
import { syncSitePublication } from "@/lib/site/membership";

/**
 * Team-facing management of the "TDP Website" gallery — the v2 home of the
 * globe gesture. Unlike the public scene API in this namespace, these routes
 * require a logged-in user (the /api/site middleware exemption only skips the
 * login REDIRECT; getAuthUser still returns 401 JSON).
 *
 * POST   { sceneKey, imageIds }  add images to a scene's section (publishes)
 * DELETE { imageIds }            remove images from EVERY website section
 *                                (unpublishes once the last membership is gone)
 * GET                            the gallery's event id, or null if not created
 */

/** Ownership gate shared by POST/DELETE: only the user's own images qualify. */
async function ownedImageIds(
  supabase: Awaited<ReturnType<typeof getAuthUser>>["supabase"],
  userId: string,
  imageIds: string[]
): Promise<string[]> {
  const { data: images } = await supabase
    .from("images")
    .select("id, events!event_id(user_id)")
    .in("id", imageIds);
  return (images ?? [])
    .filter((img) => {
      const event = img.events as { user_id?: string } | null;
      return event && event.user_id === userId;
    })
    .map((img) => img.id);
}

export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: gallery } = await supabase
      .from("events")
      .select("id")
      .eq("slug", WEBSITE_EVENT_SLUG)
      .eq("user_id", user!.id)
      .maybeSingle();

    return NextResponse.json({ eventId: gallery?.id ?? null });
  } catch (error) {
    console.error("Website gallery lookup error:", error);
    return NextResponse.json(
      { error: "Failed to look up website gallery" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sceneKey, imageIds } = (await request.json()) as {
      sceneKey?: string;
      imageIds?: string[];
    };

    if (!sceneKey || !imageIds?.length) {
      return NextResponse.json(
        { error: "sceneKey and imageIds required" },
        { status: 400 }
      );
    }
    if (!isValidScene(sceneKey)) {
      return NextResponse.json(
        { error: `Unknown scene: ${sceneKey}` },
        { status: 400 }
      );
    }

    const ownedIds = await ownedImageIds(supabase, user!.id, imageIds);
    if (ownedIds.length === 0) {
      return NextResponse.json({ error: "No accessible images" }, { status: 404 });
    }

    const { eventId, sectionId } = await getWebsiteSection(
      supabase,
      user!.id,
      sceneKey
    );

    const { data: targetSection } = await supabase
      .from("sections")
      .select("name, locked")
      .eq("id", sectionId)
      .maybeSingle();
    if (targetSection?.locked) {
      return NextResponse.json(
        { error: `"${targetSection.name}" is locked — unlock it to add images.` },
        { status: 423 }
      );
    }

    // Append after the section's current arrangement (same pattern as the
    // generic add-to-section route).
    const { data: maxSort } = await supabase
      .from("section_images")
      .select("sort_order")
      .eq("section_id", sectionId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextOrder = (maxSort?.sort_order ?? -1) + 1;
    const { error: insertError } = await supabase.from("section_images").upsert(
      ownedIds.map((imageId) => ({
        section_id: sectionId,
        image_id: imageId,
        sort_order: nextOrder++,
      })),
      { onConflict: "section_id,image_id" }
    );
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    const sync = await syncSitePublication(supabase, ownedIds);

    return NextResponse.json({
      added: ownedIds.length,
      failed: sync.failed.length,
      scene: sceneKey,
      sceneLabel: sceneForKey(sceneKey)?.label ?? sceneKey,
      eventId,
      sectionId,
    });
  } catch (error) {
    console.error("Add to website gallery error:", error);
    return NextResponse.json(
      { error: "Failed to add images to the website" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageIds } = (await request.json()) as { imageIds?: string[] };
    if (!imageIds?.length) {
      return NextResponse.json({ error: "imageIds required" }, { status: 400 });
    }

    const ownedIds = await ownedImageIds(supabase, user!.id, imageIds);
    if (ownedIds.length === 0) {
      return NextResponse.json({ error: "No accessible images" }, { status: 404 });
    }

    // Every website section, regardless of scene — "remove from website"
    // means the image appears nowhere on the site afterwards.
    const { data: websiteSections } = await supabase
      .from("sections")
      .select("id, locked")
      .not("site_scene_key", "is", null);
    // Locked sections keep their copies — removal there must be deliberate.
    const sectionIds = (websiteSections ?? [])
      .filter((s) => !s.locked)
      .map((s) => s.id);
    const lockedSkipped = (websiteSections ?? []).filter((s) => s.locked).length;

    if (sectionIds.length > 0) {
      const { error: deleteError } = await supabase
        .from("section_images")
        .delete()
        .in("section_id", sectionIds)
        .in("image_id", ownedIds);
      if (deleteError) {
        return NextResponse.json({ error: deleteError.message }, { status: 500 });
      }
    }

    const sync = await syncSitePublication(supabase, ownedIds);

    return NextResponse.json({
      removed: ownedIds.length,
      failed: sync.failed.length,
      lockedSectionsSkipped: lockedSkipped,
    });
  } catch (error) {
    console.error("Remove from website gallery error:", error);
    return NextResponse.json(
      { error: "Failed to remove images from the website" },
      { status: 500 }
    );
  }
}
