import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { autoFocalForImages } from "@/lib/site/focal";
import { scheduleSiteRevalidate } from "@/lib/site/revalidate";

/**
 * POST /api/sections/[sectionId]/suggest-focal
 *
 * Bulk focal-point suggestion for a section: every member image with NO
 * focal point and exactly one confident detected face gets the face-based
 * suggestion (eye level) written as its focal point. Manual picks are never
 * touched — this only fills nulls, same contract as the publish-time
 * auto-focal in membership sync.
 *
 * Returns the written values so the editor can update its grid state and the
 * focal sweep can show what was set. Owner-only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { sectionId } = await params;

    // Verify the caller owns the section's event.
    const { data: section } = await supabase
      .from("sections")
      .select("id, events!event_id(user_id)")
      .eq("id", sectionId)
      .maybeSingle();
    const owner = (section?.events as { user_id?: string } | null)?.user_id;
    if (!section || owner !== user!.id) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // Member images still missing a focal point (videos use posters and can
    // hold focal points too, but face detection only ran on images — the
    // suggestion map will simply be empty for them).
    const { data: links, error: linksError } = await supabase
      .from("section_images")
      .select("image_id, images!inner(id, focal_x, site_published_at)")
      .eq("section_id", sectionId)
      .is("images.focal_x", null);
    if (linksError) throw linksError;

    const rows = (links ?? []) as unknown as Array<{
      image_id: string;
      images: { id: string; focal_x: number | null; site_published_at: string | null };
    }>;
    const candidateIds = rows.map((r) => r.image_id);

    const suggestions = await autoFocalForImages(supabase, candidateIds);

    const written: Array<{ imageId: string; x: number; y: number }> = [];
    let anyPublished = false;
    for (const [imageId, focal] of suggestions) {
      const { error } = await supabase
        .from("images")
        .update({ focal_x: focal.x, focal_y: focal.y })
        .eq("id", imageId)
        // Belt and braces: never overwrite a value written since we read.
        .is("focal_x", null);
      if (error) {
        console.error(`Bulk focal suggest failed for ${imageId}:`, error);
        continue;
      }
      written.push({ imageId, x: focal.x, y: focal.y });
      if (rows.find((r) => r.image_id === imageId)?.images.site_published_at) {
        anyPublished = true;
      }
    }

    // Focal points render on the live site — refresh its cache when any of
    // the updated images are published.
    if (anyPublished) scheduleSiteRevalidate();

    return NextResponse.json({
      count: written.length,
      candidates: candidateIds.length,
      suggestions: written,
    });
  } catch (error) {
    console.error("Bulk focal suggest error:", error);
    return NextResponse.json(
      { error: "Failed to suggest focal points" },
      { status: 500 }
    );
  }
}
