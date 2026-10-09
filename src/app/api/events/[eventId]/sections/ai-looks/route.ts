import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  AI_LOOKS_JOB_META,
  AI_LOOKS_SECTION_NAME,
  isAiLooksMeta,
  isAiLooksSection,
  planAiLooksLinks,
} from "@/lib/sections/ai-looks";

export const runtime = "nodejs";
// WebexOne-sized galleries hold ~10k photos; the reads below are paged and
// the link inserts are batched, so this is a few seconds at most.
export const maxDuration = 60;

const PAGE_SIZE = 1000;

/**
 * POST /api/events/[eventId]/sections/ai-looks
 *
 * One click: gather every AI render in the gallery into an "AI Looks" section.
 * No body. Owner-only (404 for a gallery that is not yours).
 *
 * A render is a row with `images.sps_source_image_id` set, the one marker the
 * SPS pull writes for frames SimplePhotoShare generated. `section_images` is a
 * link table, so this ADDS a membership per render and removes nothing: the
 * render stays beside its person and also shows here.
 *
 * Idempotent. The section is found by `job_meta.kind = "ai-looks"` (a hand-made
 * section named "AI Looks" is adopted and stamped), else created after the last
 * section with `is_auto: false` and `sort_mode: "filename"`. A second click
 * links only the renders that landed since; members a person dragged in by
 * hand are left alone. "Rebuild all sections" keeps it (rebuild.ts).
 *
 * Response: `{ sectionId, name, linked, total, created }`
 *   linked  — renders linked by THIS call
 *   total   — renders in the event (so the client can say "AI Looks · 438")
 *   created — true when this call made the section
 * 400 when the event has no renders; 409 when the section is locked.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    // OWNERSHIP-SCOPED: getAuthUser's service client bypasses RLS.
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    // 1. Every render in the event. Paged with a total order (created_at, id):
    // an unpaged select caps at 1,000 silently, and a page without a unique
    // tiebreaker can repeat or skip rows (GOTCHAS, lesson 88).
    const renderIds: string[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("images")
        .select("id")
        .eq("event_id", eventId)
        .not("sps_source_image_id", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throw error;
      for (const r of data ?? []) renderIds.push(r.id);
      if (!data || data.length < PAGE_SIZE) break;
    }
    if (renderIds.length === 0) {
      return NextResponse.json(
        {
          error:
            "This gallery has no AI renders. They come across with a SimplePhotoShare pull.",
        },
        { status: 400 }
      );
    }

    // 2. The event's AI Looks section, or a fresh one after the last section.
    const { data: sections, error: secErr } = await supabase
      .from("sections")
      .select("id, name, locked, job_meta, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });
    if (secErr) throw secErr;

    const marked = (sections ?? []).find((s) => isAiLooksMeta(s.job_meta));
    const byName = marked
      ? undefined
      : (sections ?? []).find(
          (s) => s.job_meta == null && isAiLooksSection({ name: s.name, jobMeta: s.job_meta })
        );
    let section = marked ?? byName;
    let created = false;

    if (section?.locked) {
      return NextResponse.json(
        { error: `"${section.name}" is locked. Unlock it to add renders.` },
        { status: 409 }
      );
    }

    if (section && !marked) {
      // Adopt the hand-made section: stamp it so the rebuild keeps it and the
      // next click finds it by marker, not by whatever it gets renamed to.
      const { error } = await supabase
        .from("sections")
        .update({ job_meta: AI_LOOKS_JOB_META })
        .eq("id", section.id)
        .eq("event_id", eventId);
      if (error) throw error;
    }

    if (!section) {
      const last = (sections ?? []).reduce(
        (max, s) => Math.max(max, s.sort_order ?? -1),
        -1
      );
      const { data: made, error } = await supabase
        .from("sections")
        .insert({
          event_id: eventId,
          name: AI_LOOKS_SECTION_NAME,
          sort_order: last + 1,
          is_auto: false,
          // Renders are named for the person they were made from, so the
          // filename order groups each person's looks together.
          sort_mode: "filename",
          job_meta: AI_LOOKS_JOB_META,
        })
        .select("id, name, locked, job_meta, sort_order")
        .single();
      if (error || !made) throw error || new Error("section insert failed");
      section = made;
      created = true;
    }

    // 3. Current members (paged, ordered) so the plan skips what is linked and
    // continues sort_order after the section's own max.
    const existing: { imageId: string; sortOrder: number | null }[] = [];
    if (!created) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("section_images")
          .select("image_id, sort_order")
          .eq("section_id", section.id)
          .order("sort_order", { ascending: true })
          .order("image_id", { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) throw error;
        for (const r of data ?? []) existing.push({ imageId: r.image_id, sortOrder: r.sort_order });
        if (!data || data.length < PAGE_SIZE) break;
      }
    }

    // 4. Link what is missing, 500 at a time. Upsert on the link's primary key
    // so two clicks racing each other cannot fail on a duplicate.
    const plan = planAiLooksLinks(renderIds, existing);
    for (let i = 0; i < plan.length; i += 500) {
      const rows = plan.slice(i, i + 500).map((p) => ({
        section_id: section.id,
        image_id: p.imageId,
        sort_order: p.sortOrder,
      }));
      const { error } = await supabase
        .from("section_images")
        .upsert(rows, { onConflict: "section_id,image_id", ignoreDuplicates: true });
      if (error) throw error;
    }

    return NextResponse.json({
      sectionId: section.id,
      name: section.name,
      linked: plan.length,
      total: renderIds.length,
      created,
    });
  } catch (error) {
    await reportSystemError("sections.ai-looks", error, { eventId });
    return NextResponse.json(
      { error: "Couldn't build the AI Looks section" },
      { status: 500 }
    );
  }
}
