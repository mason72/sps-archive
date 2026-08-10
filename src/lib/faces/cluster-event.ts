/**
 * Face clustering v2 — DB orchestration around clustering-core.ts.
 *
 * Write contract: touches ONLY faces.person_id and the persons table. Never
 * deletes a NAMED person (names are user data); unnamed persons that end up
 * with zero faces are pruned. Safe to re-run any time — assignment is
 * incremental and existing person ids are stable.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { extractPersonName } from "@/lib/gallery/stacks";
import { isPersonLike } from "@/lib/sections/auto-plan";

import {
  centroidOf,
  planClustering,
  type ClusterOptions,
  type FaceVec,
  type PersonCentroid,
} from "./clustering-core";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export interface ClusterResult {
  totalFaces: number;
  assignedToExisting: number;
  personsCreated: number;
  personsPruned: number;
  /** Persons auto-named from filename consensus this run (fill-nulls-only). */
  personsNamed: number;
  unassigned: number;
}

/** Page through all embedded faces for an event (PostgREST caps at 1000). */
async function fetchEventFaces(
  supabase: SupabaseDB,
  eventId: string
): Promise<{ faces: FaceVec[]; filenameOf: Map<string, string> }> {
  const faces: FaceVec[] = [];
  const filenameOf = new Map<string, string>();
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("faces")
      .select("id, image_id, embedding, quality, person_id, images!inner(event_id, original_filename)")
      .eq("images.event_id", eventId)
      .not("embedding", "is", null)
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      faces.push({
        id: row.id,
        imageId: row.image_id,
        // pgvector comes back as its text form, which is valid JSON.
        embedding: JSON.parse(row.embedding as unknown as string),
        quality: row.quality,
        personId: row.person_id,
      });
      const img = row.images as unknown as { original_filename: string };
      filenameOf.set(row.image_id, img.original_filename);
    }
    if (!data || data.length < 1000) break;
  }
  return { faces, filenameOf };
}

/**
 * Filename-derived name for a person, when the cluster's own files agree.
 * Headshot exports are usually named after the subject — that consensus IS
 * the name (Mason, 2026-08-10: "they are named after the individuals").
 * Requirements: ≥80% of members share one extracted name, ≥2 supporting
 * files, and it must look like a person-name (photobooth/camera-code
 * filenames fail and stay blank). Fill-nulls-only — never overwrites.
 */
export function consensusName(
  memberImageIds: string[],
  filenameOf: Map<string, string>,
  extractName: (filename: string) => string,
  personLike: (name: string) => boolean
): string | null {
  const counts = new Map<string, { count: number; display: string }>();
  let considered = 0;
  for (const imageId of new Set(memberImageIds)) {
    const filename = filenameOf.get(imageId);
    if (!filename) continue;
    const name = extractName(filename).trim();
    considered += 1;
    if (!name) continue;
    const key = name.toLowerCase();
    const cur = counts.get(key) ?? { count: 0, display: name };
    cur.count += 1;
    counts.set(key, cur);
  }
  if (!considered) return null;
  let best: { count: number; display: string } | null = null;
  for (const v of counts.values()) {
    if (!best || v.count > best.count) best = v;
  }
  if (!best || best.count < 2 || best.count / considered < 0.8) return null;
  return personLike(best.display) ? best.display : null;
}

export async function clusterEventFaces(
  supabase: SupabaseDB,
  eventId: string,
  options?: ClusterOptions
): Promise<ClusterResult> {
  const { faces, filenameOf } = await fetchEventFaces(supabase, eventId);
  if (!faces.length) {
    return { totalFaces: 0, assignedToExisting: 0, personsCreated: 0, personsPruned: 0, personsNamed: 0, unassigned: 0 };
  }

  const { data: personRows, error: pErr } = await supabase
    .from("persons")
    .select("id, name")
    .eq("event_id", eventId);
  if (pErr) throw pErr;

  // Centroids from current membership; a person whose faces were all
  // re-indexed away (replace-per-image drops person_id) simply has no members
  // right now — keep it only if named, so the name can be re-attached by a
  // future assignment... which needs a centroid, so memberless persons can't
  // attract faces this run and get pruned unless named.
  const byPerson = new Map<string, FaceVec[]>();
  for (const f of faces) {
    if (f.personId) {
      const list = byPerson.get(f.personId) ?? [];
      list.push(f);
      byPerson.set(f.personId, list);
    }
  }
  const persons: PersonCentroid[] = (personRows ?? [])
    .filter((p) => byPerson.has(p.id))
    .map((p) => ({
      id: p.id,
      name: p.name,
      centroid: centroidOf(byPerson.get(p.id)!.map((f) => f.embedding)),
      faceCount: byPerson.get(p.id)!.length,
    }));

  const plan = planClustering(faces, persons, options);

  // 1. Assign to existing persons, grouped into one update per person.
  const byTarget = new Map<string, string[]>();
  for (const [faceId, personId] of plan.assignments) {
    const list = byTarget.get(personId) ?? [];
    list.push(faceId);
    byTarget.set(personId, list);
  }
  for (const [personId, faceIds] of byTarget) {
    const { error } = await supabase.from("faces").update({ person_id: personId }).in("id", faceIds);
    if (error) throw error;
  }

  // 2. Create new persons and attach their members.
  let personsCreated = 0;
  const createdMembers = new Map<string, string[]>();
  for (const cluster of plan.newClusters) {
    const { data: created, error } = await supabase
      .from("persons")
      .insert({ event_id: eventId })
      .select("id")
      .single();
    if (error) throw error;
    personsCreated += 1;
    createdMembers.set(created.id, cluster.map((f) => f.id));
    const { error: updErr } = await supabase
      .from("faces")
      .update({ person_id: created.id })
      .in("id", cluster.map((f) => f.id));
    if (updErr) throw updErr;
  }

  // 3. Refresh face_count + representative face for every person, then prune
  //    UNNAMED persons that hold no faces. Membership is computed from data
  //    already in memory — a re-query here would need paging (lesson 39) for
  //    nothing: faces[] + the plan IS the post-write state.
  const finalPerson = new Map<string, string>(); // faceId → personId
  for (const f of faces) if (f.personId) finalPerson.set(f.id, f.personId);
  for (const [faceId, personId] of plan.assignments) finalPerson.set(faceId, personId);
  // newClusters were written with freshly created ids, tracked below.
  const members = new Map<string, { id: string; quality: number }[]>();
  const qualityOf = new Map(faces.map((f) => [f.id, f.quality]));
  for (const [faceId, personId] of finalPerson) {
    const list = members.get(personId) ?? [];
    list.push({ id: faceId, quality: qualityOf.get(faceId) ?? 0 });
    members.set(personId, list);
  }
  for (const [personId, faceIds] of createdMembers) {
    members.set(
      personId,
      faceIds.map((id) => ({ id, quality: qualityOf.get(id) ?? 0 }))
    );
  }
  for (const list of members.values()) list.sort((a, b) => b.quality - a.quality);

  const { data: allPersons, error: apErr } = await supabase
    .from("persons")
    .select("id, name, face_count, representative_face_id")
    .eq("event_id", eventId);
  if (apErr) throw apErr;

  const imageIdOfFace = new Map(faces.map((f) => [f.id, f.imageId]));
  // Faces per image (among embedded faces): representative selection prefers
  // SOLO portraits — a group-photo face as the cover crop can show the WRONG
  // person when a stray face contaminated the cluster (seen live: a friend's
  // face fronting Bianca's card).
  const facesPerImage = new Map<string, number>();
  for (const f of faces) {
    facesPerImage.set(f.imageId, (facesPerImage.get(f.imageId) ?? 0) + 1);
  }
  let personsPruned = 0;
  let personsNamed = 0;
  for (const p of allPersons ?? []) {
    const list = members.get(p.id) ?? [];
    if (!list.length) {
      if (!p.name) {
        const { error } = await supabase.from("persons").delete().eq("id", p.id);
        if (error) throw error;
        personsPruned += 1;
      }
      continue;
    }
    // Quality-desc, but solo-portrait faces outrank group-photo faces.
    const solo = list.filter(
      (m) => (facesPerImage.get(imageIdOfFace.get(m.id) ?? "") ?? 0) === 1
    );
    const representative = (solo[0] ?? list[0]).id;
    // Fill-nulls-only filename consensus naming (never overwrites a name).
    const autoName = p.name
      ? null
      : consensusName(
          list.map((m) => imageIdOfFace.get(m.id)!).filter(Boolean),
          filenameOf,
          extractPersonName,
          isPersonLike
        );
    if (autoName) personsNamed += 1;
    if (
      p.face_count !== list.length ||
      p.representative_face_id !== representative ||
      autoName
    ) {
      const { error } = await supabase
        .from("persons")
        .update({
          face_count: list.length,
          representative_face_id: representative,
          ...(autoName ? { name: autoName } : {}),
        })
        .eq("id", p.id);
      if (error) throw error;
    }
  }

  return {
    totalFaces: faces.length,
    assignedToExisting: plan.assignments.size,
    personsCreated,
    personsPruned,
    personsNamed,
    unassigned: plan.unassigned.length,
  };
}
