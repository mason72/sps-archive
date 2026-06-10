import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { scheduleSiteRevalidate } from "@/lib/site/revalidate";

/**
 * PUT /api/sections/[sectionId]/images/reorder
 * Persist a manual (drag-to-reorder) arrangement for a section.
 * Body: { imageIds: string[] } — the FULL desired order of the section.
 *
 * Writes section_images.sort_order = index for each image in one batched
 * upsert. The posted list is treated as authoritative for ORDER only: it is
 * intersected with the section's current membership (so a stale client can't
 * drop rows), then any members missing from the payload are appended at the end
 * — this keeps the write safe against a concurrent add/remove.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;
    const body = await request.json();
    const { imageIds } = body as { imageIds: string[] };

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return NextResponse.json({ error: "imageIds is required" }, { status: 400 });
    }

    // Verify section ownership through the event chain (mirrors POST/DELETE).
    const { data: section } = await supabase
      .from("sections")
      .select("id, event_id, name, site_scene_key, locked")
      .eq("id", sectionId)
      .single();

    if (!section) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", section.event_id)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    if (section.locked) {
      return NextResponse.json(
        { error: `"${section.name}" is locked — unlock it to rearrange it.` },
        { status: 423 }
      );
    }

    // Current membership — the source of truth for which rows exist.
    const { data: members, error: memberErr } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", sectionId);

    if (memberErr) throw memberErr;

    const memberSet = new Set((members || []).map((m) => m.image_id));

    // Posted order, intersected with membership, de-duplicated.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of imageIds) {
      if (memberSet.has(id) && !seen.has(id)) {
        ordered.push(id);
        seen.add(id);
      }
    }
    // Append any members the client didn't include (race with add), stable order.
    for (const id of memberSet) {
      if (!seen.has(id)) ordered.push(id);
    }

    // One batched upsert. Only the conflict-key + sort_order are written, so
    // relevance_score (nullable, unused) on existing rows is left untouched.
    const rows = ordered.map((image_id, i) => ({
      section_id: sectionId,
      image_id,
      sort_order: i,
    }));

    const { error } = await supabase
      .from("section_images")
      .upsert(rows, { onConflict: "section_id,image_id" });

    if (error) throw error;

    // Drag order is the site's display order (and picks slot winners) —
    // refresh the site cache when a website section was rearranged.
    if (section.site_scene_key) scheduleSiteRevalidate();

    return NextResponse.json({ reordered: true, count: rows.length });
  } catch (error) {
    console.error("Reorder section images error:", error);
    return NextResponse.json(
      { error: "Failed to reorder section images" },
      { status: 500 }
    );
  }
}
