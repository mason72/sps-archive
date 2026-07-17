import { createServiceClient } from "@/lib/supabase/server";
import { autoFocalForImages } from "@/lib/site/focal";
import { detectFacesViaModal, isFaceDetectionConfigured } from "@/lib/faces/detect";

type SupabaseClient = ReturnType<typeof createServiceClient>;

/**
 * Make sure a set of images has face-based focal points where a single
 * confident subject exists: detect faces for never-scanned images (Modal,
 * best-effort), persist the boxes, then write eye-level focal_x/focal_y —
 * FILLING NULLS ONLY, the same contract as the editor's section sweep and
 * the site publish-time auto-focal. Manual picks are never touched.
 *
 * Background use (cover jobs): capped per call; detection failures degrade
 * to whatever face data already exists.
 *
 * Returns how many focal points were written.
 */
export async function ensureAutoFocal(
  supabase: SupabaseClient,
  images: Array<{ id: string; r2_key: string }>,
  opts: { scanCap?: number } = {}
): Promise<number> {
  if (images.length === 0) return 0;
  const scanCap = opts.scanCap ?? 80;

  // Only images still missing a focal point are candidates.
  const { data: rows } = await supabase
    .from("images")
    .select("id, r2_key, focal_x")
    .in("id", images.map((i) => i.id))
    .is("focal_x", null);
  const candidates = rows ?? [];
  if (candidates.length === 0) return 0;

  if (isFaceDetectionConfigured()) {
    const { data: existingFaces } = await supabase
      .from("faces")
      .select("image_id")
      .in("image_id", candidates.map((c) => c.id));
    const scanned = new Set((existingFaces ?? []).map((f) => f.image_id));
    const toScan = candidates
      .filter((c) => !scanned.has(c.id))
      .slice(0, scanCap)
      .map((c) => ({ id: c.id, r2Key: c.r2_key }));

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
        if (faceRows.length > 0) {
          const { error } = await supabase.from("faces").insert(faceRows);
          if (error) throw error;
        }
      } catch (err) {
        // Best-effort: suggest from whatever face data exists; a later run
        // retries the unscanned images.
        console.error("ensureAutoFocal: detection failed:", err);
      }
    }
  }

  const suggestions = await autoFocalForImages(
    supabase,
    candidates.map((c) => c.id)
  );
  let written = 0;
  for (const [imageId, focal] of suggestions) {
    const { error } = await supabase
      .from("images")
      .update({ focal_x: focal.x, focal_y: focal.y })
      .eq("id", imageId)
      // Never overwrite a value written since we read.
      .is("focal_x", null);
    if (!error) written++;
  }
  return written;
}
