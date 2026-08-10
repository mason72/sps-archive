import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseClient = ReturnType<typeof createServiceClient>;

/**
 * Face-based auto focal points.
 *
 * The Modal pipeline already detects faces at ingest and persists a normalized
 * bounding box (0–1) plus a quality score (detection confidence × face size)
 * per face — so suggesting a focal point is pure arithmetic, no new inference.
 *
 * Rules:
 *  - exactly ONE face above the quality bar → eye-level anchor on the subject.
 *  - SEVERAL confident faces (groups, couples) → anchor the group: horizontal
 *    center of the union box (keeps everyone in the crop), vertical at the
 *    mean eye level. (Added 2026-08-10 — groups previously got nothing and
 *    tall crops beheaded them; a group anchor beats a blind top bias.)
 *  - zero confident faces (landscapes, props, silhouettes) → no suggestion.
 * Bystander faces below the bar never disqualify or drag a clear subject.
 */

export interface FaceBox {
  /** Normalized 0–1 bounding box, as stored by the Modal pipeline. */
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  /** Detection confidence × face-size factor (see modal/ai_pipeline.py). */
  quality: number;
}

/**
 * Minimum face quality to count as a deliberate subject. The pipeline scores
 * quality = det_score × min(1, area×20), so a confident (~0.85) face filling
 * ≥2% of the frame lands around 0.34 — typical for a half-body portrait —
 * while background bystanders score well under this.
 */
export const AUTO_FOCAL_MIN_QUALITY = 0.3;

/** Round to one decimal, matching the manual picker's precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * The focal point implied by an image's detected faces, or null.
 *
 * Placement is eye level, not bbox center: horizontal center of the face, 35%
 * down from the bbox top. Crops that keep the eyes in frame look intentional;
 * crops centered on the nose clip foreheads at tight aspect ratios.
 */
export function computeAutoFocal(
  faces: FaceBox[]
): { x: number; y: number } | null {
  const subjects = faces.filter((f) => f.quality >= AUTO_FOCAL_MIN_QUALITY);
  if (subjects.length === 0) return null;

  let x: number;
  let y: number;
  if (subjects.length === 1) {
    const face = subjects[0];
    x = (face.bbox_x + face.bbox_w / 2) * 100;
    y = (face.bbox_y + face.bbox_h * 0.35) * 100;
  } else {
    // Group: center of the union box horizontally (everyone stays in frame),
    // mean eye level vertically (faces at different depths average out).
    const left = Math.min(...subjects.map((f) => f.bbox_x));
    const right = Math.max(...subjects.map((f) => f.bbox_x + f.bbox_w));
    x = ((left + right) / 2) * 100;
    y =
      (subjects.reduce((sum, f) => sum + f.bbox_y + f.bbox_h * 0.35, 0) /
        subjects.length) *
      100;
  }
  return {
    x: round1(Math.min(100, Math.max(0, x))),
    y: round1(Math.min(100, Math.max(0, y))),
  };
}

/**
 * Batch auto-focal lookup: one faces query for all images, computed per image.
 * Images with no qualifying single face are simply absent from the result.
 */
export async function autoFocalForImages(
  supabase: SupabaseClient,
  imageIds: string[]
): Promise<Map<string, { x: number; y: number }>> {
  const result = new Map<string, { x: number; y: number }>();
  if (imageIds.length === 0) return result;

  const { data: faces, error } = await supabase
    .from("faces")
    .select("image_id, bbox_x, bbox_y, bbox_w, bbox_h, quality")
    .in("image_id", imageIds);
  if (error) throw error;

  const byImage = new Map<string, FaceBox[]>();
  for (const face of faces ?? []) {
    const arr = byImage.get(face.image_id);
    if (arr) arr.push(face);
    else byImage.set(face.image_id, [face]);
  }

  for (const [imageId, imageFaces] of byImage) {
    const focal = computeAutoFocal(imageFaces);
    if (focal) result.set(imageId, focal);
  }
  return result;
}
