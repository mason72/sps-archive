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
  /** personId → crew display name, for clusters linked via crew_persons. */
  crewNameByPersonId: Map<string, string>;
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

  // Crew links, loaded HERE so both consumers agree: the people route needs
  // them for the "Christie Jones · crew" labels, and the suggestion filter
  // below needs them so the badge count matches the cards shown.
  const crewNameByPersonId = new Map<string, string>();
  {
    const personIds = (persons ?? []).map((p) => p.id);
    for (let i = 0; i < personIds.length; i += 200) {
      const { data: links, error: linkErr } = await supabase
        .from("crew_persons")
        .select("person_id, crew!inner(display_name)")
        .in("person_id", personIds.slice(i, i + 200));
      if (linkErr) throw linkErr;
      for (const l of links ?? []) {
        crewNameByPersonId.set(
          l.person_id,
          (l.crew as unknown as { display_name: string }).display_name
        );
      }
    }
  }

  const raw = computeSuggestions(
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

  // A crew LINK is a human's identity statement, and it outranks every
  // filename-derived guess. Without this filter, Christie's crew-linked
  // 77-face cluster kept getting "might be two people — files split 4/3
  // between Marriott Green and Tjeerd Jan" cards from the junk names on her
  // costume shoot — the split engine second-guessing an identity a human
  // already settled. Same rule for mislabels, merges and refinements: junk
  // filenames say nothing about a cluster whose person is KNOWN.
  const linked = (id: string) => crewNameByPersonId.has(id);
  const suggestions = {
    mislabels: raw.mislabels.filter((s) => !linked(s.personId)),
    merges: raw.merges.filter((s) => !linked(s.fromId) && !linked(s.intoId)),
    refinements: raw.refinements.filter((s) => !linked(s.personId)),
    splits: raw.splits.filter((s) => !linked(s.personId)),
  };

  return {
    persons: persons ?? [],
    memberImages,
    faceById,
    personImageFace,
    suggestions,
    crewNameByPersonId,
  };
}

export function dismissedSetFrom(settings: unknown): Set<string> {
  return new Set(
    ((settings ?? {}) as { people?: { dismissedSuggestions?: string[] } }).people
      ?.dismissedSuggestions ?? []
  );
}
