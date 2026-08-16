import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

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

    /**
     * PostgREST puts `.in()` values in the QUERY STRING, so a filter list is
     * URL length, and a long enough one comes back as a bare 400 "Bad Request"
     * — which surfaced here as a 500 with no detail at all.
     *
     * Both filters below are unbounded in practice: `imageIds` is every image
     * already linked to the section (thousands), and `filenames` is the whole
     * drop (Mason dropped 1,197 in one go on 2026-08-16 and this route failed
     * 36 times). Worse, it SELF-AMPLIFIES — the more that lands in a section,
     * the longer `imageIds` gets, so the check degrades exactly as the section
     * it is protecting fills up.
     *
     * So page it: chunk the filename side, keep each request's URL bounded, and
     * merge. The image-id side rides along in each chunk, which is why the
     * chunk is small — 200 filenames plus the id list still fits comfortably.
     */
    const NAME_CHUNK = 200;
    const ID_CHUNK = 400;
    const found: Array<{ id: string; original_filename: string }> = [];
    for (let n = 0; n < filenames.length; n += NAME_CHUNK) {
      const nameSlice = filenames.slice(n, n + NAME_CHUNK);
      for (let i = 0; i < imageIds.length; i += ID_CHUNK) {
        const idSlice = imageIds.slice(i, i + ID_CHUNK);
        const { data, error } = await supabase
          .from("images")
          .select("id, original_filename")
          .in("id", idSlice)
          .in("original_filename", nameSlice)
          .eq("processing_status", "complete");
        if (error) throw error;
        for (const row of data ?? []) {
          found.push(row as { id: string; original_filename: string });
        }
      }
    }

    // Only a COMPLETE row proves the photo is actually archived. A "pending"
    // row is a presign reservation whose binary may never have landed — and
    // reporting one as a duplicate is actively dangerous: after the HDC // 2026
    // loss the section held 2,258 backing-less rows, so re-uploading the very
    // files that went missing would have flagged each one as a duplicate of its
    // own ghost, and "Skip all duplicates" would have skipped precisely the
    // photos the photographer was re-uploading to recover.
    const duplicates: Record<string, string[]> = {};
    for (const img of found) {
      const name = img.original_filename;
      (duplicates[name] = duplicates[name] || []).push(img.id);
    }

    return NextResponse.json({ duplicates });
  } catch (error) {
    // Was a bare console.error, and that is WHY the 2026-08-16 upload wedge had
    // no evidence anywhere: this route failed 36 times in 25 minutes and wrote
    // not one `system_errors` row. The client swallows a failure here on
    // purpose (better to allow an upload than to block on a flaky check), so
    // this report is the only trace it will ever leave.
    await reportSystemError("api/sections/check-duplicates", error);
    return NextResponse.json(
      { error: "Failed to check duplicates" },
      { status: 500 }
    );
  }
}
