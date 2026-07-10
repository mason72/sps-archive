import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  planAutoSections,
  type PlanMode,
  type PlanImage,
} from "@/lib/sections/auto-plan";

export const runtime = "nodejs";
export const maxDuration = 60;

const MODES: PlanMode[] = ["letter", "per-person", "even"];
/** Refuse to create an absurd number of sections (e.g. per-person on 2000 people). */
const MAX_SECTIONS = 60;

/**
 * POST /api/events/[eventId]/auto-sections
 *
 * Materialize name-based "smart sections" for a big upload. Body:
 *   { mode: "letter" | "per-person" | "even", target: number, stacks?: boolean }
 *
 * Wipes the event's existing AUTO sections (is_auto=true) and rebuilds them
 * from the deterministic plan; manual sections (Highlights, anything the
 * photographer made) are never touched. Additive: images join the new
 * sections, keeping any existing membership. Returns the updated section list.
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
      mode?: PlanMode;
      target?: number;
      stacks?: boolean;
    };
    const mode = body.mode ?? "letter";
    if (!MODES.includes(mode)) {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    const target = Math.max(1, Math.min(Math.floor(body.target ?? 300), 5000));
    const stacks = !!body.stacks;

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

    const plan = planAutoSections(images, { mode, target, stacks });
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

    return NextResponse.json({ sections: enriched, created: plan.length });
  } catch (error) {
    console.error("Auto-sections error:", error);
    await reportSystemError("sections.auto-generate", error, { eventId: eventIdForReport });
    return NextResponse.json({ error: "Failed to generate sections" }, { status: 500 });
  }
}
