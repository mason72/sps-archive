import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { detectNaming, type PlanImage } from "@/lib/sections/auto-plan";
import { INTAKE_SECTION_NAME } from "@/lib/sections/intake";
import { rebuildKeepReason, type ExistingSectionFate } from "@/lib/sections/rebuild";

export const runtime = "nodejs";

/**
 * GET /api/events/[eventId]/section-plan
 *
 * Feeds the "Sort into sections" preview: returns the event's images (id +
 * names only) plus a detection summary (how many people, does it look
 * person-named, suggested mode + target). The client runs the SAME pure
 * `planAutoSections` locally so the slider updates instantly, then POSTs the
 * chosen config to /auto-sections to apply. Ownership-scoped.
 *
 * Also returns `existing`: every current section except the intake, with the
 * fate the apply will give it — `keep` (and why) or null for replaced — from
 * the SAME rule the apply uses (src/lib/sections/rebuild.ts), so the dialog
 * lists exactly what is about to go. Highlights carries its photo count: a
 * filled Highlights is kept as is, and the dialog must not promise new picks.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

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

    const { data: sections, error: secErr } = await supabase
      .from("sections")
      .select("id, name, locked, filter_query, site_scene_key, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });
    if (secErr) throw secErr;
    const existing: ExistingSectionFate[] = await Promise.all(
      (sections ?? [])
        .filter((s) => s.name.trim().toLowerCase() !== INTAKE_SECTION_NAME.toLowerCase())
        .map(async (s) => {
          const { count } = await supabase
            .from("section_images")
            .select("*", { count: "exact", head: true })
            .eq("section_id", s.id);
          return {
            id: s.id,
            name: s.name,
            imageCount: count ?? 0,
            keep: rebuildKeepReason({
              name: s.name,
              locked: s.locked,
              filterQuery: s.filter_query,
              siteSceneKey: s.site_scene_key,
            }),
          };
        })
    );

    return NextResponse.json({ images, detection: detectNaming(images), existing });
  } catch (error) {
    console.error("Section-plan error:", error);
    return NextResponse.json({ error: "Failed to build section plan" }, { status: 500 });
  }
}
