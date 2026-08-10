import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/events/[eventId]/smart-section
 *   { name, imageIds, mode: "copy" | "move" }
 *
 * Materializes ONE additive section from a description-driven search. Unlike
 * the whole-gallery rebuild this creates nothing else and wipes nothing: the
 * section is `is_auto: false`, so a later "Rebuild all sections" leaves it
 * alone — it's the photographer's section, made with help.
 *
 * copy: the photos join this section AND stay where they are (membership is a
 *       reference, never a duplicate file).
 * move: the photos join this section and leave every OTHER section of this
 *       event.
 * Ownership-scoped; image ids are re-validated against the event.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const body = (await request.json()) as {
      name?: string;
      imageIds?: string[];
      mode?: "copy" | "move";
    };
    const name = body.name?.trim().slice(0, 120);
    const mode = body.mode === "move" ? "move" : "copy";
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    if (!body.imageIds?.length) {
      return NextResponse.json({ error: "imageIds required" }, { status: 400 });
    }

    // Re-validate every id against this event (never trust the client's list).
    const { data: owned, error: ownErr } = await supabase
      .from("images")
      .select("id")
      .eq("event_id", eventId)
      .in("id", body.imageIds.slice(0, 2000));
    if (ownErr) throw ownErr;
    const imageIds = (owned ?? []).map((r) => r.id);
    if (!imageIds.length) {
      return NextResponse.json({ error: "No matching photos" }, { status: 400 });
    }

    const { data: lastSection } = await supabase
      .from("sections")
      .select("sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: false })
      .limit(1);
    const sortOrder = (lastSection?.[0]?.sort_order ?? -1) + 1;

    const { data: created, error: secErr } = await supabase
      .from("sections")
      .insert({ event_id: eventId, name, sort_order: sortOrder, is_auto: false })
      .select("id")
      .single();
    if (secErr || !created) throw secErr || new Error("section insert failed");

    if (mode === "move") {
      // Leave every other section of this event first, so the photos end up
      // only here. Section rows elsewhere are memberships, not copies.
      const { data: otherSections } = await supabase
        .from("sections")
        .select("id")
        .eq("event_id", eventId)
        .neq("id", created.id);
      const otherIds = (otherSections ?? []).map((s) => s.id);
      if (otherIds.length) {
        const { error: delErr } = await supabase
          .from("section_images")
          .delete()
          .in("section_id", otherIds)
          .in("image_id", imageIds);
        if (delErr) throw delErr;
      }
    }

    const rows = imageIds.map((imageId, i) => ({
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

    return NextResponse.json({
      sections: enriched,
      sectionId: created.id,
      added: imageIds.length,
      mode,
    });
  } catch (error) {
    await reportSystemError("sections.smart-section", error, { eventId });
    return NextResponse.json({ error: "Failed to create the section" }, { status: 500 });
  }
}
