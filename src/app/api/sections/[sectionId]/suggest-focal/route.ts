import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { createServiceClient } from "@/lib/supabase/server";
import { autoFocalForImages } from "@/lib/site/focal";
import { scheduleSiteRevalidate } from "@/lib/site/revalidate";
import {
  detectFacesViaModal,
  isFaceDetectionConfigured,
} from "@/lib/faces/detect";

// On-demand face detection for a section can take a minute cold.
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/sections/[sectionId]/suggest-focal
 *
 * Bulk focal-point suggestion for a section: every member image with NO
 * focal point and exactly one confident detected face gets the face-based
 * suggestion (eye level) written as its focal point. Manual picks are never
 * touched — this only fills nulls, same contract as the publish-time
 * auto-focal in membership sync.
 *
 * Images that have never been face-scanned (the shelved AI pipeline left the
 * faces table empty) are detected ON DEMAND via the Modal face pipeline and
 * their boxes persisted, so subsequent calls — and the per-image suggestion
 * marker in the sweep — get them for free.
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

    // Member images still missing a focal point.
    const { data: links, error: linksError } = await supabase
      .from("section_images")
      .select("image_id, images!inner(id, r2_key, focal_x, site_published_at)")
      .eq("section_id", sectionId)
      .is("images.focal_x", null);
    if (linksError) throw linksError;

    const rows = (links ?? []) as unknown as Array<{
      image_id: string;
      images: {
        id: string;
        r2_key: string;
        focal_x: number | null;
        site_published_at: string | null;
      };
    }>;
    const candidateIds = rows.map((r) => r.image_id);

    // Detect faces on demand for candidates that have never been scanned.
    // Detection runs on the 800px thumbnail (works for video posters too) and
    // the boxes are persisted, so this is a one-time cost per image.
    let detected = 0;
    if (candidateIds.length > 0 && isFaceDetectionConfigured()) {
      const { data: existingFaces } = await supabase
        .from("faces")
        .select("image_id")
        .in("image_id", candidateIds);
      const scanned = new Set((existingFaces ?? []).map((f) => f.image_id));
      const toScan = rows
        .filter((r) => !scanned.has(r.image_id))
        .map((r) => ({ id: r.image_id, r2Key: r.images.r2_key }))
        .slice(0, 200);

      if (toScan.length > 0) {
        try {
          const detections = await detectFacesViaModal(toScan);
          const faceRows = [...detections.entries()].flatMap(([imageId, boxes]) =>
            boxes.map((b) => ({
              image_id: imageId,
              bbox_x: b.bbox_x,
              bbox_y: b.bbox_y,
              bbox_w: b.bbox_w,
              bbox_h: b.bbox_h,
              quality: b.quality,
            }))
          );
          detected = detections.size;
          if (faceRows.length > 0) {
            // Service client: ownership is verified above, and the faces
            // table has no insert policy for regular users.
            const service = createServiceClient();
            const { error: insertError } = await service
              .from("faces")
              .insert(faceRows);
            if (insertError) throw insertError;
          }
        } catch (err) {
          // Detection is best-effort: fall through and suggest from whatever
          // face data exists. The next click retries the unscanned images.
          console.error("On-demand face detection failed:", err);
        }
      }
    }

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
