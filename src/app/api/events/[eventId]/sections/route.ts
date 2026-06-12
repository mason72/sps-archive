import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/events/[eventId]/sections
 *
 * Lightweight section list for a gallery — id, name, lock state, member
 * count. Exists for pickers (cross-gallery copy/move) that need a target
 * gallery's sections without paying for GET /api/events/[eventId], which
 * loads and presigns every image. Owner-only.
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
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    const { data: sections, error } = await supabase
      .from("sections")
      .select("id, name, locked, site_scene_key, sort_order, created_at, section_images(count)")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      sections: (sections ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        locked: s.locked ?? false,
        siteSceneKey: s.site_scene_key ?? null,
        imageCount:
          (s.section_images as unknown as Array<{ count: number }>)?.[0]
            ?.count ?? 0,
      })),
    });
  } catch (error) {
    console.error("List sections error:", error);
    return NextResponse.json(
      { error: "Failed to load sections" },
      { status: 500 }
    );
  }
}
