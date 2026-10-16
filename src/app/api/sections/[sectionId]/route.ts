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
import { loadSectionLinks } from "@/lib/sections/gallery-members";

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
    .select("id, event_id, name, site_scene_key, locked, sort_seed")
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

    // Per-section photo order. null clears back to the event default; the
    // seed only means anything for "random" and is generated here so every
    // client sees the SAME shuffle (a client-side seed would give each
    // visitor a different gallery).
    if (body.sortMode !== undefined) {
      const VALID = ["upload", "filename", "date-taken", "manual", "random"];
      if (body.sortMode !== null && !VALID.includes(body.sortMode)) {
        return NextResponse.json({ error: "Invalid sortMode" }, { status: 400 });
      }
      updates.sort_mode = body.sortMode;
      if (body.sortMode === "random") {
        // Reshuffle when asked, or when switching into random with no seed.
        updates.sort_seed =
          body.reshuffle === true || section.sort_seed == null
            ? Math.floor(Math.random() * 1e9)
            : section.sort_seed;
      } else {
        updates.sort_seed = null;
      }
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
        sortMode: data.sort_mode ?? null,
        sortSeed: data.sort_seed ?? null,
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
    // A failed read must stop the delete: with no fallback nothing is rescued,
    // and the cascade would strip every sole-member photo of its section.
    const { data: fallback, error: fallbackErr } = await supabase
      .from("sections")
      .select("id")
      .eq("event_id", section.event_id)
      .neq("id", sectionId)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (fallbackErr) throw fallbackErr;
    // No other section means the last-section guard above did not hold (its
    // count read can fail quietly). Deleting now would strip every photo here
    // of its only section, so refuse.
    if (!fallback) {
      return NextResponse.json(
        { error: "Cannot delete the last section" },
        { status: 400 }
      );
    }

    // Every link of this section, paged and error-checked. This read used to
    // be a single select, capped at 1,000 rows with its error ignored, so
    // deleting a 3,000-photo section rescued only the first 1,000 and the
    // cascade silently stripped the rest of their only section (lesson 184).
    const imageIds = (await loadSectionLinks(supabase, [sectionId])).map(
      (l) => l.image_id
    );

    if (imageIds.length > 0) {
      // Which of them also live in another section? Chunked: one `.in()` with
      // thousands of ids overflows the URL, and an ignored error here read as
      // "lives nowhere else".
      const safe = new Set<string>();
      // 100 ids per chunk keeps each answer far under the 1,000-row cap even
      // when a photo also sits in several other sections.
      for (let i = 0; i < imageIds.length; i += 100) {
        const { data: otherLinks, error: otherErr } = await supabase
          .from("section_images")
          .select("image_id")
          .in("image_id", imageIds.slice(i, i + 100))
          .neq("section_id", sectionId);
        if (otherErr) throw otherErr;
        for (const l of otherLinks ?? []) safe.add(l.image_id);
      }
      const orphaning = imageIds.filter((id) => !safe.has(id));

      if (orphaning.length > 0) {
        // Append after the fallback's own photos; numbering from 0 interleaved
        // the rescued ones with the photographer's manual order at the top.
        const { data: last, error: lastErr } = await supabase
          .from("section_images")
          .select("sort_order")
          .eq("section_id", fallback.id)
          .order("sort_order", { ascending: false })
          .limit(1);
        if (lastErr) throw lastErr;
        const base = (last?.[0]?.sort_order ?? -1) + 1;
        const { error: rescueError } = await supabase
          .from("section_images")
          .upsert(
            orphaning.map((image_id, i) => ({
              section_id: fallback.id,
              image_id,
              sort_order: base + i,
            })),
            { onConflict: "section_id,image_id", ignoreDuplicates: true }
          );
        if (rescueError) throw rescueError;
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
