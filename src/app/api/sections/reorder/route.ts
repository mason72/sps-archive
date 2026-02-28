import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * PUT /api/sections/reorder
 * Reorder sections by providing an array of IDs in the desired order.
 * Body: { eventId: string, sectionIds: string[] }
 */
export async function PUT(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const { eventId, sectionIds } = body as {
      eventId: string;
      sectionIds: string[];
    };

    if (!eventId || !sectionIds?.length) {
      return NextResponse.json(
        { error: "eventId and sectionIds are required" },
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

    // Update sort_order for each section
    await Promise.all(
      sectionIds.map((id, index) =>
        supabase
          .from("sections")
          .update({ sort_order: index })
          .eq("id", id)
          .eq("event_id", eventId)
      )
    );

    return NextResponse.json({ reordered: true });
  } catch (error) {
    console.error("Reorder sections error:", error);
    return NextResponse.json(
      { error: "Failed to reorder sections" },
      { status: 500 }
    );
  }
}
