import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { nanoid } from "nanoid";

/**
 * POST /api/events/[eventId]/duplicate
 * Duplicate an event — copies metadata + settings + sections (not images).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Fetch original event
    const { data: original, error: fetchError } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (fetchError || !original) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    // Create duplicate with new slug
    const newSlug = nanoid(10);
    const { data: newEvent, error: createError } = await supabase
      .from("events")
      .insert({
        user_id: user!.id,
        name: `${original.name} (Copy)`,
        slug: newSlug,
        event_type: original.event_type,
        event_date: original.event_date,
        description: original.description,
        settings: original.settings || {},
      })
      .select()
      .single();

    if (createError) throw createError;

    // Copy sections (without images)
    const { data: sections } = await supabase
      .from("sections")
      .select("name, description, is_auto, sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true });

    if (sections && sections.length > 0) {
      await supabase.from("sections").insert(
        sections.map((s) => ({
          event_id: newEvent.id,
          name: s.name,
          description: s.description,
          is_auto: false, // Don't mark as auto in the copy
          sort_order: s.sort_order,
        }))
      );
    }

    return NextResponse.json({
      event: {
        id: newEvent.id,
        name: newEvent.name,
        slug: newEvent.slug,
      },
    });
  } catch (error) {
    console.error("Duplicate event error:", error);
    return NextResponse.json(
      { error: "Failed to duplicate event" },
      { status: 500 }
    );
  }
}
