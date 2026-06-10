import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { syncSitePublication } from "@/lib/site/membership";

/**
 * Helper: verify section ownership through event → user chain.
 */
async function verifySectionOwnership(
  supabase: ReturnType<typeof import("@/lib/supabase/server").createServiceClient>,
  sectionId: string,
  userId: string
) {
  const { data: section } = await supabase
    .from("sections")
    .select("id, event_id, name, site_scene_key, locked")
    .eq("id", sectionId)
    .single();

  if (!section) return null;

  const { data: event } = await supabase
    .from("events")
    .select("id")
    .eq("id", section.event_id)
    .eq("user_id", userId)
    .single();

  if (!event) return null;
  return section;
}

/**
 * PATCH /api/sections/[sectionId]
 * Rename a section or update its description.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;
    const body = await request.json();

    const section = await verifySectionOwnership(supabase, sectionId, user!.id);
    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    // The lock toggle itself — deliberately editable while locked (that's how
    // you unlock; the lock guards content, not its own switch).
    if (typeof body.locked === "boolean") updates.locked = body.locked;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sections")
      .update(updates)
      .eq("id", sectionId)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      section: {
        id: data.id,
        name: data.name,
        description: data.description,
        isAuto: data.is_auto,
        sortOrder: data.sort_order,
        locked: data.locked,
      },
    });
  } catch (error) {
    console.error("Update section error:", error);
    return NextResponse.json({ error: "Failed to update section" }, { status: 500 });
  }
}

/**
 * DELETE /api/sections/[sectionId]
 * Delete a section (images are NOT deleted, just unlinked).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;

    const section = await verifySectionOwnership(supabase, sectionId, user!.id);
    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    if (section.locked) {
      return NextResponse.json(
        { error: `"${section.name}" is locked — unlock it to delete the section.` },
        { status: 423 }
      );
    }

    // Guard: cannot delete the last section
    const { count } = await supabase
      .from("sections")
      .select("id", { count: "exact", head: true })
      .eq("event_id", section.event_id);

    if (count !== null && count <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last section" },
        { status: 400 }
      );
    }

    // Before deleting, rescue any photo that lives ONLY in this section by
    // reassigning it to a fallback section. Deleting a section must never
    // orphan its photos (the FK cascade would otherwise just drop the links).
    const { data: fallback } = await supabase
      .from("sections")
      .select("id")
      .eq("event_id", section.event_id)
      .neq("id", sectionId)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: links } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", sectionId);
    const imageIds = (links ?? []).map((l) => l.image_id);

    if (fallback) {
      if (imageIds.length > 0) {
        const { data: otherLinks } = await supabase
          .from("section_images")
          .select("image_id")
          .in("image_id", imageIds)
          .neq("section_id", sectionId);
        const safe = new Set((otherLinks ?? []).map((l) => l.image_id));
        const orphaning = imageIds.filter((id) => !safe.has(id));

        if (orphaning.length > 0) {
          const { error: rescueError } = await supabase
            .from("section_images")
            .insert(
              orphaning.map((image_id, i) => ({
                section_id: fallback.id,
                image_id,
                sort_order: i,
              }))
            );
          if (rescueError) throw rescueError;
        }
      }
    }

    const { error } = await supabase
      .from("sections")
      .delete()
      .eq("id", sectionId);

    if (error) throw error;

    // Deleting a website section unpublishes members that aren't in any other
    // website section (the rescue above may have moved orphans into one).
    if (section.site_scene_key && imageIds.length > 0) {
      await syncSitePublication(supabase, imageIds);
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete section error:", error);
    return NextResponse.json({ error: "Failed to delete section" }, { status: 500 });
  }
}
