import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  planAutoSections,
  type PlanMode,
  type PlanImage,
} from "@/lib/sections/auto-plan";
import { CURATED_SECTION_NAME, INTAKE_SECTION_NAME } from "@/lib/sections/intake";
import { clampHighlightCount } from "@/lib/highlights/auto-fill";

export const runtime = "nodejs";
// Scene mode embeds the taxonomy via Modal (cold start can take ~20s) and
// scores every image before materializing.
export const maxDuration = 120;

const MODES: PlanMode[] = ["letter", "per-person", "even", "full-set"];
/** Refuse to create an absurd number of sections (e.g. per-person on 2000 people). */
const MAX_SECTIONS = 60;

/**
 * POST /api/events/[eventId]/auto-sections
 *
 * Materialize name-based "smart sections" for a big upload. Body:
 *   { mode: "letter" | "per-person" | "even", target: number, stacks?: boolean,
 *     highlights?: number }
 *
 * Wipes the event's existing AUTO sections (is_auto=true) and rebuilds them
 * from the deterministic plan; manual sections (Highlights, anything the
 * photographer made) are never touched. Additive: images join the new
 * sections, keeping any existing membership. Returns the updated section list.
 *
 * `highlights: N` also puts a Highlights section FIRST and asks for it to be
 * filled with N picks once AI indexing settles (src/lib/highlights/auto-fill.ts).
 * A Highlights section that already holds hand-picked photos is moved to the
 * front and otherwise left alone.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  let eventIdForReport: string | undefined;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;
    eventIdForReport = eventId;

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json()) as {
      mode?: PlanMode | "scenes";
      target?: number;
      stacks?: boolean;
      taxonomy?: string;
      highlights?: number | null;
    };
    const mode = body.mode ?? "letter";
    if (mode !== "scenes" && !MODES.includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    const target = Math.max(1, Math.min(Math.floor(body.target ?? 300), 5000));
    const stacks = !!body.stacks;

    let plan: { name: string; imageIds: string[] }[];
    if (mode === "scenes") {
      // AI scene plan — computed server-side from stored embeddings, exactly
      // as the preview endpoint showed it. Materializes through the same
      // auto-section contract below (is_auto wipe, additive, intake consume).
      const { buildScenePlan } = await import("@/lib/sections/scene-plan");
      const { defaultTaxonomyKey, taxonomyByKey } = await import(
        "@/lib/sections/scene-taxonomies"
      );
      const { data: ev } = await supabase
        .from("events")
        .select("event_type")
        .eq("id", eventId)
        .single();
      const key =
        body.taxonomy && taxonomyByKey(body.taxonomy)
          ? body.taxonomy
          : defaultTaxonomyKey(ev?.event_type ?? null);
      const scenes = await buildScenePlan(supabase, eventId, user!.id, key);
      if (scenes.indexedCount === 0) {
        return NextResponse.json(
          { error: "These photos aren't AI-indexed yet — try again in a little while." },
          { status: 409 }
        );
      }
      plan = scenes.plan;
    } else {
      // Load every image for the event (id + names only — the planner is pure).
      const images: PlanImage[] = [];
      let offset = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("images")
          .select("id, parsed_name, original_filename")
          .eq("event_id", eventId)
          .order("created_at", { ascending: true })
          .range(offset, offset + 999);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) {
          images.push({ id: r.id, parsedName: r.parsed_name, originalFilename: r.original_filename });
        }
        if (data.length < 1000) break;
        offset += 1000;
      }

      if (images.length === 0) {
        return NextResponse.json(
          { error: "No images to sort yet — upload some first." },
          { status: 400 }
        );
      }

      plan = planAutoSections(images, { mode, target, stacks });
    }
    if (plan.length === 0) {
      return NextResponse.json({ error: "Nothing to sort." }, { status: 400 });
    }
    if (plan.length > MAX_SECTIONS) {
      return NextResponse.json(
        {
          error: `That would make ${plan.length} sections. Raise the max-per-section, or switch off "one section per person".`,
        },
        { status: 400 }
      );
    }

    // Wipe existing AUTO sections (cascade removes their section_images);
    // manual sections (is_auto=false) are untouched.
    const { error: delErr } = await supabase
      .from("sections")
      .delete()
      .eq("event_id", eventId)
      .eq("is_auto", true);
    if (delErr) throw delErr;

    // Place new sections after any manual ones.
    const { data: lastManual } = await supabase
      .from("sections")
      .select("sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: false })
      .limit(1);
    let nextSort = (lastManual?.[0]?.sort_order ?? -1) + 1;

    for (const section of plan) {
      const { data: created, error: secErr } = await supabase
        .from("sections")
        .insert({
          event_id: eventId,
          name: section.name,
          sort_order: nextSort++,
          is_auto: true,
          // Every plan mode groups by NAME (A–H, per-person, even splits of
          // the name list), so the only order that makes sense inside one is
          // alphabetical. Leaving this NULL inherited the event default —
          // usually upload order — and a section literally labelled "P–S"
          // opened in the order the photos happened to arrive.
          sort_mode: "filename",
        })
        .select("id")
        .single();
      if (secErr || !created) throw secErr || new Error("section insert failed");

      const rows = section.imageIds.map((imageId, i) => ({
        section_id: created.id,
        image_id: imageId,
        sort_order: i,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: linkErr } = await supabase
          .from("section_images")
          .upsert(rows.slice(i, i + 500), { onConflict: "section_id,image_id" });
        if (linkErr) throw linkErr;
      }
    }

    // Consume the "Unsorted" intake — the smart sections cover every image in
    // the event, so its photos are now safely sectioned and the dump can go.
    // (Cascade drops its section_images; Highlights + manual sections stay.)
    await supabase
      .from("sections")
      .delete()
      .eq("event_id", eventId)
      .ilike("name", INTAKE_SECTION_NAME);

    // Highlights, first in line (the toggle). Runs after the plan so a failure
    // above never leaves a half-configured Highlights behind.
    const highlightsCount = clampHighlightCount(body.highlights);
    let highlights: { status: "waiting" | "kept" | "failed"; count?: number } | null = null;
    if (highlightsCount) {
      // The sort above is already committed. A Highlights problem is reported
      // in the response, never as a failed sort.
      try {
        highlights = await ensureHighlights(supabase, eventId, highlightsCount);
      } catch (err) {
        await reportSystemError("sections.highlights-toggle", err, { eventId });
        highlights = { status: "failed" };
      }
      if (highlights.status === "waiting") {
        // Best effort: if AI is already done this fills within minutes; if the
        // send fails (or AI is still running) the 30-minute sweep picks it up.
        try {
          const { inngest } = await import("@/lib/inngest/client");
          await inngest.send({ name: "highlights/auto-fill.requested", data: { eventId } });
        } catch (err) {
          await reportSystemError("sections.highlights-auto-fill.send", err, { eventId });
        }
      }
    }

    // Return the updated section list with counts.
    const { data: sections, error: listErr } = await supabase
      .from("sections")
      .select("id, name, is_auto, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });
    if (listErr) throw listErr;

    const enriched = await Promise.all(
      (sections || []).map(async (s) => {
        const { count } = await supabase
          .from("section_images")
          .select("*", { count: "exact", head: true })
          .eq("section_id", s.id);
        return { id: s.id, name: s.name, isAuto: s.is_auto, imageCount: count || 0 };
      })
    );

    return NextResponse.json({ sections: enriched, created: plan.length, highlights });
  } catch (error) {
    console.error("Auto-sections error:", error);
    await reportSystemError("sections.auto-generate", error, { eventId: eventIdForReport });
    return NextResponse.json({ error: "Failed to generate sections" }, { status: 500 });
  }
}

/**
 * Put Highlights first and, when nobody has curated it, ask for it to be
 * filled with `count` picks. Only an EMPTY Highlights is (re)armed: a filled
 * one, whether the machine or a person filled it, is kept and moved to the
 * front, because a person may have edited the machine's picks since and a
 * sort must never discard curation. Re-picking is the Review button's job.
 */
async function ensureHighlights(
  supabase: Awaited<ReturnType<typeof getAuthUser>>["supabase"],
  eventId: string,
  count: number
): Promise<{ status: "waiting" | "kept"; count?: number }> {
  const { data: first, error: firstErr } = await supabase
    .from("sections")
    .select("sort_order")
    .eq("event_id", eventId)
    .order("sort_order", { ascending: true })
    .limit(1);
  if (firstErr) throw firstErr;
  const frontOrder = (first?.[0]?.sort_order ?? 0) - 1;

  // Names are unique case-insensitively (migration 048): an exact match would
  // miss a migrated "HIGHLIGHTS" and then collide with it on insert.
  const { data: existing, error: exErr } = await supabase
    .from("sections")
    .select("id, locked")
    .eq("event_id", eventId)
    .ilike("name", CURATED_SECTION_NAME)
    .maybeSingle();
  if (exErr) throw exErr;

  if (!existing) {
    const { error } = await supabase.from("sections").insert({
      event_id: eventId,
      name: CURATED_SECTION_NAME,
      sort_order: frontOrder,
      is_auto: false,
      highlights_auto_count: count,
    });
    if (error) throw error;
    return { status: "waiting", count };
  }

  const { count: members, error: mErr } = await supabase
    .from("section_images")
    .select("image_id", { count: "exact", head: true })
    .eq("section_id", existing.id);
  if (mErr) throw mErr;
  const arm = !existing.locked && (members ?? 0) === 0;
  const { error } = await supabase
    .from("sections")
    .update(
      arm
        ? { sort_order: frontOrder, highlights_auto_count: count, highlights_auto_filled_at: null }
        : { sort_order: frontOrder }
    )
    .eq("id", existing.id);
  if (error) throw error;
  return arm ? { status: "waiting", count } : { status: "kept" };
}
