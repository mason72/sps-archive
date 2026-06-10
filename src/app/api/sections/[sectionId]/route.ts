import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { syncSitePublication } from "@/lib/site/membership";
import { scheduleSiteRevalidate } from "@/lib/site/revalidate";
import {
  isJobSceneKey,
  isValidJobSlug,
  validateJobMeta,
  JOB_KEY_PREFIX,
} from "@/lib/site/jobs";

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
 * Rename a section, update its description or lock, or — on TDP Work job
 * sections — save the job-sheet metadata (jobMeta) and edit the frozen URL
 * slug (jobSlug). Job edits ping the site's revalidate webhook; renames
 * don't (the section name is editor-only — the site shows eventName).
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

    // Job-sheet fields (TDP Work gallery only). Like renames, these stay
    // editable while locked — the lock guards membership/order, and the job
    // form is always a deliberate act.
    const isJobSection = isJobSceneKey(section.site_scene_key);
    if (body.jobMeta !== undefined) {
      if (!isJobSection) {
        return NextResponse.json(
          { error: "jobMeta is only valid on TDP Work job sections" },
          { status: 400 }
        );
      }
      const result = validateJobMeta(body.jobMeta);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      updates.job_meta = result.meta;
    }
    if (body.jobSlug !== undefined) {
      if (!isJobSection) {
        return NextResponse.json(
          { error: "jobSlug is only valid on TDP Work job sections" },
          { status: 400 }
        );
      }
      if (typeof body.jobSlug !== "string" || !isValidJobSlug(body.jobSlug)) {
        return NextResponse.json(
          { error: "Slug must be lowercase words separated by single hyphens" },
          { status: 400 }
        );
      }
      updates.site_scene_key = `${JOB_KEY_PREFIX}${body.jobSlug}`;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("sections")
      .update(updates)
      .eq("id", sectionId)
      .select()
      .single();

    if (error) {
      // Unique index on site_scene_key — another job already owns this slug.
      if (error.code === "23505" && updates.site_scene_key) {
        return NextResponse.json(
          { error: "That slug is already used by another job" },
          { status: 409 }
        );
      }
      throw error;
    }

    // Job edits change what the site renders — refresh its cache. Strictly
    // scoped: only job sections reach here with these fields set.
    if (updates.job_meta !== undefined || updates.site_scene_key !== undefined) {
      scheduleSiteRevalidate();
    }

    return NextResponse.json({
      section: {
        id: data.id,
        name: data.name,
        description: data.description,
        isAuto: data.is_auto,
        sortOrder: data.sort_order,
        locked: data.locked,
        siteSceneKey: data.site_scene_key ?? null,
        jobMeta: data.job_meta ?? null,
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
