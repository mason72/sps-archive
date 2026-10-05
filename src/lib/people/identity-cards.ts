/**
 * The face crops a suggestion card is decided on — the anonymous cluster's
 * representative face and the matched reference's. Shared by the review
 * queue and the auto-matched strip (2026-10-04).
 */
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";

import type { SupabaseDB } from "./identity-decide";

export interface FaceCropPayload {
  thumbnailUrl: string;
  bbox: { x: number; y: number; w: number; h: number };
  imageWidth: number | null;
  imageHeight: number | null;
}

export async function repFaceCrop(
  supabase: SupabaseDB,
  personId: string | null
): Promise<FaceCropPayload | null> {
  if (!personId) return null;
  const { data: person } = await supabase
    .from("persons")
    .select("representative_face_id")
    .eq("id", personId)
    .maybeSingle();
  if (!person?.representative_face_id) return null;
  const { data: face } = await supabase
    .from("faces")
    .select("bbox_x, bbox_y, bbox_w, bbox_h, images!inner(r2_key, width, height)")
    .eq("id", person.representative_face_id)
    .maybeSingle();
  if (!face) return null;
  const img = face.images as unknown as {
    r2_key: string;
    width: number | null;
    height: number | null;
  };
  return {
    thumbnailUrl: await getPresignedDownloadUrl(getThumbnailKey(img.r2_key), 14400),
    bbox: { x: face.bbox_x, y: face.bbox_y, w: face.bbox_w, h: face.bbox_h },
    imageWidth: img.width,
    imageHeight: img.height,
  };
}

