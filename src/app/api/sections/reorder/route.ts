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

    // Single atomic statement (migration 018). The previous
    // Promise.all of N individual UPDATEs left sort_orders incoherent
    // on any partial failure — the historical "sections came back
    // wrong" bug.
    const { error: rpcError } = await supabase.rpc("reorder_sections", {
      p_event_id: eventId,
      p_section_ids: sectionIds,
    });

    if (rpcError) {
      console.error("reorder_sections RPC error:", rpcError);
      return NextResponse.json(
        { error: "Failed to reorder sections" },
        { status: 500 }
      );
    }

    return NextResponse.json({ reordered: true });
  } catch (error) {
    console.error("Reorder sections error:", error);
    return NextResponse.json(
      { error: "Failed to reorder sections" },
      { status: 500 }
    );
  }
}
