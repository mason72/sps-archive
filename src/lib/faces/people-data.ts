/**
 * Shared assembly for the People surfaces: one paged sweep over an event's
 * assigned faces produces everything the people route, the suggestions
 * computation, and the badge-count endpoint need. No presigning here —
 * callers decide what becomes a URL.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { extractPersonName } from "@/lib/gallery/stacks";
import { isPersonLike } from "@/lib/sections/auto-plan";

import {
  computeSuggestions,
  type MergeSuggestion,
  type MislabelSuggestion,
  type RefinementSuggestion,
  type SplitSuggestion,
} from "./suggestions";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface FaceRef {
  imageId: string;
  bbox: { x: number; y: number; w: number; h: number };
  imageWidth: number | null;
  imageHeight: number | null;
  r2Key: string;
}

export interface PeopleData {
  persons: {
    id: string;
    name: string | null;
    face_count: number;
    representative_face_id: string | null;
  }[];
  memberImages: Map<string, Set<string>>;
  /** faceId → face (bbox + image dims + key). */
  faceById: Map<string, FaceRef>;
  /** `${personId}:${imageId}` → the face that clustered there (for crops). */
  personImageFace: Map<string, FaceRef>;
  suggestions: {
    mislabels: MislabelSuggestion[];
    merges: MergeSuggestion[];
    refinements: RefinementSuggestion[];
    splits: SplitSuggestion[];
  };
}

export async function loadPeopleData(
  supabase: SupabaseDB,
  eventId: string,
  dismissed: Set<string>
): Promise<PeopleData> {
  const { data: persons, error: pErr } = await supabase
    .from("persons")
    .select("id, name, face_count, representative_face_id")
    .eq("event_id", eventId)
    .order("face_count", { ascending: false });
  if (pErr) throw pErr;

  const memberImages = new Map<string, Set<string>>();
  const faceById = new Map<string, FaceRef>();
  const personImageFace = new Map<string, FaceRef>();
  const imageMeta = new Map<string, { parsedName: string | null; originalFilename: string }>();
  // TOTAL faces per image (assigned or not) — solo-portrait detection for
  // mislabel suggestions; a group photo is never a rename candidate.
  const faceCountByImage = new Map<string, number>();

  for (let page = 0; ; page++) {
    const { data: rows, error } = await supabase
      .from("faces")
      .select(
        "id, image_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, quality, images!inner(event_id, r2_key, width, height, parsed_name, original_filename)"
      )
      .eq("images.event_id", eventId)
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const row of rows ?? []) {
      const img = row.images as unknown as {
        r2_key: string;
        width: number | null;
        height: number | null;
        parsed_name: string | null;
        original_filename: string;
      };
      faceCountByImage.set(row.image_id, (faceCountByImage.get(row.image_id) ?? 0) + 1);
      const ref: FaceRef = {
        imageId: row.image_id,
        bbox: { x: row.bbox_x, y: row.bbox_y, w: row.bbox_w, h: row.bbox_h },
        imageWidth: img.width,
        imageHeight: img.height,
        r2Key: img.r2_key,
      };
      faceById.set(row.id, ref);
      imageMeta.set(row.image_id, {
        parsedName: img.parsed_name,
        originalFilename: img.original_filename,
      });
      if (!row.person_id) continue;
      const set = memberImages.get(row.person_id) ?? new Set();
      set.add(row.image_id);
      memberImages.set(row.person_id, set);
      const key = `${row.person_id}:${row.image_id}`;
      if (!personImageFace.has(key)) personImageFace.set(key, ref);
    }
    if (!rows || rows.length < 1000) break;
  }

  const suggestions = computeSuggestions(
    (persons ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      imageIds: [...(memberImages.get(p.id) ?? [])],
      faceCount: p.face_count,
    })),
    imageMeta,
    faceCountByImage,
    extractPersonName,
    isPersonLike,
    dismissed
  );

  return { persons: persons ?? [], memberImages, faceById, personImageFace, suggestions };
}

export function dismissedSetFrom(settings: unknown): Set<string> {
  return new Set(
    ((settings ?? {}) as { people?: { dismissedSuggestions?: string[] } }).people
      ?.dismissedSuggestions ?? []
  );
}
