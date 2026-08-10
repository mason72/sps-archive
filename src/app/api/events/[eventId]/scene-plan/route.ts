import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { buildScenePlan } from "@/lib/sections/scene-plan";
import {
  defaultTaxonomyKey,
  SCENE_TAXONOMIES,
  taxonomyByKey,
} from "@/lib/sections/scene-taxonomies";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * GET /api/events/[eventId]/scene-plan?taxonomy=<key>
 *
 * Preview for the "By scene" sort mode: proposed sections + counts, computed
 * from stored SigLIP-2 embeddings against the chosen taxonomy. Read-only —
 * apply goes through POST /auto-sections with mode "scenes". Ownership-scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, event_type")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const requested = new URL(request.url).searchParams.get("taxonomy");
    const key =
      requested && taxonomyByKey(requested)
        ? requested
        : defaultTaxonomyKey(event.event_type);

    const { count: totalImages } = await supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("media_type", "image")
      .eq("thumbnail_generated", true);

    const { plan, indexedCount } = await buildScenePlan(supabase, eventId, user!.id, key);
    if (indexedCount === 0) {
      return NextResponse.json(
        { error: "These photos aren't AI-indexed yet — try again in a little while." },
        { status: 409 }
      );
    }

    return NextResponse.json({
      taxonomies: SCENE_TAXONOMIES.map((t) => ({ key: t.key, label: t.label })),
      defaultKey: key,
      plan: plan.map((s) => ({ name: s.name, count: s.imageIds.length })),
      indexedCount,
      totalImages: totalImages ?? indexedCount,
    });
  } catch (error) {
    await reportSystemError("sections.scene-plan", error, { eventId });
    return NextResponse.json({ error: "Couldn't build the scene preview" }, { status: 500 });
  }
}
