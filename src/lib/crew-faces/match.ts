/**
 * "Find them in the archive" — a crew member's references, run against every
 * indexed face in the caller's archive.
 *
 * This is `matchSelfie()` pointed at a reference face instead of a guest's
 * camera: the same RPC (`search_faces_by_embedding`, whose `target_event_id`
 * defaults to null — archive-wide by construction), the same ArcFace space, the
 * same person-vote idea. It reads clusters rather than raw hits because a
 * person is the unit a human can confirm: "is this Joey?" is answerable about
 * a face group; a wall of 200 individual hits is not.
 *
 * The output is SUGGESTIONS. Nothing here writes — a human confirms on the
 * panel and only that confirmation touches `crew_persons`. AI suggests, humans
 * apply, exactly as everywhere else in the faces suite.
 */
import { getCachedThumbnailUrl, getThumbnailKey } from "@/lib/r2/client";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/** Same evidence floor the selfie flow uses; ArcFace same-person ≥ ~0.5. */
const FACE_MATCH_FLOOR = 0.5;
/** Per-reference shortlist. Several references union before the vote. */
const HITS_PER_REFERENCE = 120;
/** Clusters worth a human's glance. Beyond this a list is not a shortlist. */
const MAX_SUGGESTIONS = 8;

export interface CrewClusterMatch {
  personId: string;
  eventId: string;
  eventName: string;
  eventDate: string | null;
  /** How the cluster is named in that gallery — usually blank, for crew. */
  clusterName: string | null;
  faceCount: number;
  /** Best cosine any reference scored against this cluster. */
  topSimilarity: number;
  /** How many hits above the floor support it. */
  supportingHits: number;
  /** Already confirmed as this person via crew_persons. */
  confirmed: boolean;
  /** A face to show — the cluster's representative, as a crop. */
  face: {
    url: string;
    bbox: { x: number; y: number; w: number; h: number } | null;
    imageWidth: number | null;
    imageHeight: number | null;
  } | null;
}

export async function findCrewInArchive(
  db: Db,
  { userId, crewId }: { userId: string; crewId: string }
): Promise<{ matches: CrewClusterMatch[]; referenceCount: number }> {
  const { data: refs, error: rErr } = await db
    .from("crew_faces")
    .select("embedding")
    .eq("user_id", userId)
    .eq("crew_id", crewId)
    .not("embedding", "is", null);
  if (rErr) throw rErr;
  if (!refs?.length) return { matches: [], referenceCount: 0 };

  // Every reference searches independently and the votes union — that is the
  // point of keeping a SET: the bearded-era reference finds the bearded-era
  // galleries the clean-shaven one cannot.
  const votes = new Map<string, { top: number; hits: number }>();
  for (const ref of refs) {
    const { data: hits, error } = await db.rpc("search_faces_by_embedding", {
      query_embedding: ref.embedding,
      target_user_id: userId,
      match_threshold: 0.4,
      match_count: HITS_PER_REFERENCE,
    });
    if (error) throw error;
    for (const h of (hits ?? []) as { person_id: string | null; similarity: number }[]) {
      if (!h.person_id || h.similarity < FACE_MATCH_FLOOR) continue;
      const v = votes.get(h.person_id) ?? { top: 0, hits: 0 };
      v.top = Math.max(v.top, h.similarity);
      v.hits += 1;
      votes.set(h.person_id, v);
    }
  }
  if (!votes.size) return { matches: [], referenceCount: refs.length };

  const shortlist = [...votes.entries()]
    .sort((a, b) => b[1].top - a[1].top || b[1].hits - a[1].hits)
    .slice(0, MAX_SUGGESTIONS * 2); // room for confirmed rows to be marked, not crowd out

  const personIds = shortlist.map(([id]) => id);
  const { data: persons, error: pErr } = await db
    .from("persons")
    .select(
      "id, name, face_count, representative_face_id, event_id, events!inner(id, name, event_date, user_id)"
    )
    .in("id", personIds)
    .eq("events.user_id", userId);
  if (pErr) throw pErr;

  const { data: links } = await db
    .from("crew_persons")
    .select("person_id")
    .eq("user_id", userId)
    .eq("crew_id", crewId);
  const confirmed = new Set((links ?? []).map((l: { person_id: string }) => l.person_id));

  // Representative faces, resolved in one pass.
  const repIds = (persons ?? [])
    .map((p: { representative_face_id: string | null }) => p.representative_face_id)
    .filter(Boolean) as string[];
  const repById = new Map<string, any>();
  if (repIds.length) {
    const { data: reps } = await db
      .from("faces")
      .select("id, bbox_x, bbox_y, bbox_w, bbox_h, images!inner(r2_key, width, height)")
      .in("id", repIds);
    for (const f of reps ?? []) repById.set(f.id, f);
  }

  const matches: CrewClusterMatch[] = [];
  for (const p of persons ?? []) {
    const v = votes.get(p.id);
    if (!v) continue;
    const rep = p.representative_face_id ? repById.get(p.representative_face_id) : null;
    matches.push({
      personId: p.id,
      eventId: p.events.id,
      eventName: p.events.name,
      eventDate: p.events.event_date,
      clusterName: p.name,
      faceCount: p.face_count,
      topSimilarity: v.top,
      supportingHits: v.hits,
      confirmed: confirmed.has(p.id),
      face: rep
        ? {
            url: await getCachedThumbnailUrl(getThumbnailKey(rep.images.r2_key)),
            bbox: { x: rep.bbox_x, y: rep.bbox_y, w: rep.bbox_w, h: rep.bbox_h },
            imageWidth: rep.images.width,
            imageHeight: rep.images.height,
          }
        : null,
    });
  }

  matches.sort((a, b) => b.topSimilarity - a.topSimilarity);
  return { matches: matches.slice(0, MAX_SUGGESTIONS), referenceCount: refs.length };
}

/**
 * A human said yes: link the cluster, and let the confirmation TEACH.
 *
 * The cluster's representative face joins the reference set (source
 * `confirmed-suggestion`), so every yes makes the next search better — the
 * compounding path in the design doc.
 */
export async function confirmCrewPerson(
  db: Db,
  { userId, crewId, personId }: { userId: string; crewId: string; personId: string }
): Promise<{ ok: boolean; error?: string }> {
  // The person id arrives from a request body — prove the cluster lives in
  // this user's own archive before linking anything to it.
  const { data: person, error: pErr } = await db
    .from("persons")
    .select("id, representative_face_id, events!inner(user_id)")
    .eq("id", personId)
    .eq("events.user_id", userId)
    .maybeSingle();
  if (pErr) return { ok: false, error: pErr.message };
  if (!person) return { ok: false, error: "That cluster is not in your archive." };

  const { error } = await db.from("crew_persons").upsert(
    { user_id: userId, crew_id: crewId, person_id: personId, confirmed_by: "human" },
    { onConflict: "crew_id,person_id" }
  );
  if (error) return { ok: false, error: error.message };

  if (person.representative_face_id) {
    const { addTaggedFace } = await import("./store");
    // Non-fatal — the link is the decision and a failed snapshot must not undo
    // it — but REPORTED, never swallowed. A bare .catch(() => {}) here hid a
    // PostgREST ambiguous-embed error on the very first live confirmation: the
    // toast said tagged, the panel said no photos, and nothing anywhere said
    // why.
    const enriched = await addTaggedFace(db, {
      userId,
      crewId,
      faceId: person.representative_face_id,
      source: "confirmed-suggestion",
    }).catch((err) => ({ ok: false as const, error: String(err) }));
    if (!enriched.ok) {
      const { reportSystemError } = await import("@/lib/monitoring/report");
      await reportSystemError(
        "crew.confirm.enrich",
        new Error(enriched.error),
        { crewId, personId }
      );
    }
  }
  return { ok: true };
}

/** Unlink a cluster — the "no, wrong person" undo. References stay. */
export async function unconfirmCrewPerson(
  db: Db,
  { userId, crewId, personId }: { userId: string; crewId: string; personId: string }
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db
    .from("crew_persons")
    .delete()
    .eq("user_id", userId)
    .eq("crew_id", crewId)
    .eq("person_id", personId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
