import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/sections?eventId=xxx
 * List all sections for an event, ordered by sort_order.
 */
export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const eventId = request.nextUrl.searchParams.get("eventId");
    if (!eventId) {
      return NextResponse.json({ error: "eventId is required" }, { status: 400 });
    }

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
          description: section.description,
          isAuto: section.is_auto,
          sortOrder: section.sort_order,
          filterQuery: section.filter_query,
          imageCount: count || 0,
        };
      })
    );

    return NextResponse.json({ sections: enriched });
  } catch (error) {
    console.error("List sections error:", error);
    return NextResponse.json({ error: "Failed to list sections" }, { status: 500 });
  }
}

/**
 * POST /api/sections
 * Create a new manual section for an event.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { eventId, name, description } = body as {
      eventId: string;
      name: string;
      description?: string;
    };

    if (!eventId || !name) {
      return NextResponse.json(
        { error: "eventId and name are required" },
        { status: 400 }
      );
    }

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

    // Get max sort_order for this event
    const { data: maxSort } = await supabase
      .from("sections")
      .select("sort_order")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    const nextOrder = (maxSort?.sort_order ?? -1) + 1;

    const { data: section, error } = await supabase
      .from("sections")
      .insert({
        event_id: eventId,
        name,
        description: description || null,
        is_auto: false,
        sort_order: nextOrder,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      section: {
        id: section.id,
        name: section.name,
        description: section.description,
        isAuto: section.is_auto,
        sortOrder: section.sort_order,
        imageCount: 0,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Create section error:", error);
    return NextResponse.json({ error: "Failed to create section" }, { status: 500 });
  }
}
