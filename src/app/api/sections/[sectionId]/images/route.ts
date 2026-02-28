import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * GET /api/sections/[sectionId]/images?list=true
 * List image IDs belonging to a section.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;

    // Verify section ownership through event chain
    const { data: section } = await supabase
      .from("sections")
      .select("id, event_id")
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

    const { data: rows, error } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", sectionId)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    return NextResponse.json({
      imageIds: (rows || []).map((r) => r.image_id),
    });
  } catch (error) {
    console.error("List section images error:", error);
    return NextResponse.json(
      { error: "Failed to list section images" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sections/[sectionId]/images
 * Add images to a section.
 * Body: { imageIds: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;
    const body = await request.json();
    const { imageIds } = body as { imageIds: string[] };

    if (!imageIds?.length) {
      return NextResponse.json(
        { error: "imageIds is required" },
        { status: 400 }
      );
    }

    // Verify section ownership through event chain
    const { data: section } = await supabase
      .from("sections")
      .select("id, event_id")
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

    // Get max sort_order in this section
    const { data: maxSort } = await supabase
      .from("section_images")
      .select("sort_order")
      .eq("section_id", sectionId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();

    let nextOrder = (maxSort?.sort_order ?? -1) + 1;

    // Insert image links (upsert to handle duplicates gracefully)
    const rows = imageIds.map((imageId) => ({
      section_id: sectionId,
      image_id: imageId,
      sort_order: nextOrder++,
    }));

    const { error } = await supabase
      .from("section_images")
      .upsert(rows, { onConflict: "section_id,image_id" });

    if (error) throw error;

    return NextResponse.json({ added: imageIds.length });
  } catch (error) {
    console.error("Add images to section error:", error);
    return NextResponse.json(
      { error: "Failed to add images to section" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/sections/[sectionId]/images
 * Remove images from a section (does NOT delete images).
 * Body: { imageIds: string[] }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;
    const body = await request.json();
    const { imageIds } = body as { imageIds: string[] };

    if (!imageIds?.length) {
      return NextResponse.json(
        { error: "imageIds is required" },
        { status: 400 }
      );
    }

    // Verify section ownership
    const { data: section } = await supabase
      .from("sections")
      .select("id, event_id")
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

    const { error } = await supabase
      .from("section_images")
      .delete()
      .eq("section_id", sectionId)
      .in("image_id", imageIds);

    if (error) throw error;

    return NextResponse.json({ removed: imageIds.length });
  } catch (error) {
    console.error("Remove images from section error:", error);
    return NextResponse.json(
      { error: "Failed to remove images from section" },
      { status: 500 }
    );
  }
}
