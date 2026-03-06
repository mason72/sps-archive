import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { generateAutoSections } from "@/lib/ai/sections";

/**
 * POST /api/events/[eventId]/auto-sections
 * Generate AI-based sections from image scene tags.
 * Deletes existing auto sections and creates new ones.
 * Returns the full updated sections list for the event.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Verify event ownership
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Check that images exist with scene tags
    const { count: taggedCount } = await supabase
      .from("images")
      .select("*", { count: "exact", head: true })
      .eq("event_id", eventId)
      .eq("processing_status", "complete")
      .not("scene_tags", "is", null);

    if (!taggedCount || taggedCount === 0) {
      return NextResponse.json(
        { error: "No processed images with scene tags found. Upload and process images first." },
        { status: 400 }
      );
    }

    // Generate auto sections (this deletes old auto sections and creates new ones)
    await generateAutoSections(eventId);

    // Fetch the full updated sections list to return
    const { data: sections, error } = await supabase
      .from("sections")
      .select("id, name, description, is_auto, sort_order, filter_query")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    // Get image counts per section
    const enriched = await Promise.all(
      (sections || []).map(async (section) => {
        const { count } = await supabase
          .from("section_images")
          .select("*", { count: "exact", head: true })
          .eq("section_id", section.id);

        return {
          id: section.id,
          name: section.name,
          isAuto: section.is_auto,
          imageCount: count || 0,
        };
      })
    );

    return NextResponse.json({ sections: enriched });
  } catch (error) {
    console.error("Auto-sections error:", error);
    return NextResponse.json(
      { error: "Failed to generate sections" },
      { status: 500 }
    );
  }
}
