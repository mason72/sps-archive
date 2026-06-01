import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";

/**
 * POST /api/sections/[sectionId]/check-duplicates
 *
 * Given a list of filenames the user is about to upload, returns which of them
 * already exist IN THIS SECTION (by original_filename) and the existing image
 * ids for each — so the client can hold dupes for Skip/Replace before
 * uploading. Duplicate = same filename in the same section (the product's
 * chosen definition); the same name in another section is allowed.
 *
 * Body: { filenames: string[] }
 * Returns: { duplicates: { [filename]: string[] /* existing imageIds *​/ } }
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
    const filenames = (body?.filenames as string[]) ?? [];

    if (!Array.isArray(filenames) || filenames.length === 0) {
      return NextResponse.json({ duplicates: {} });
    }

    // Verify section ownership through the event → user chain.
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
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Two-step (the generated types don't model the section_images→images
    // relation, so a join won't typecheck): get this section's image ids, then
    // find which of those images have a filename in the candidate set.
    const { data: links, error: linksError } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", sectionId);
    if (linksError) throw linksError;

    const imageIds = (links ?? []).map((l) => l.image_id);
    if (imageIds.length === 0) {
      return NextResponse.json({ duplicates: {} });
    }

    const { data: imgs, error: imgError } = await supabase
      .from("images")
      .select("id, original_filename")
      .in("id", imageIds)
      .in("original_filename", filenames);
    if (imgError) throw imgError;

    const duplicates: Record<string, string[]> = {};
    for (const img of imgs ?? []) {
      const name = img.original_filename;
      (duplicates[name] = duplicates[name] || []).push(img.id);
    }

    return NextResponse.json({ duplicates });
  } catch (error) {
    console.error("Check duplicates error:", error);
    return NextResponse.json(
      { error: "Failed to check duplicates" },
      { status: 500 }
    );
  }
}
