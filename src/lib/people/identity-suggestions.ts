/**
 * The naming engine — matches ANONYMOUS face clusters against the archive's
 * named identities and writes SUGGESTIONS. A human confirms, always: two John
 * Smiths are one filename identity, and similarity is evidence, not identity.
 *
 * Division of labour: pgvector answers "who does this cluster look like"
 * (migrations 065/066 — reference centroids + match_person_cluster); this
 * module owns everything with a judgement in it — the confidence bar, the
 * skip rules, rejected names — because judgement wants unit tests, not SQL.
 *
 * THE BAR, measured 2026-08-16 against ground truth (identities that already
 * hold 2+ named clusters, hold-one-out over 80 matches):
 *   best WRONG-identity match:  p50 0.226, p90 0.291, MAX 0.363
 *   true same-identity match:   p50 0.886, p90 0.998 (low outliers are label
 *                               noise — same name, different human)
 * 0.55 clears every impostor ever observed with ~50% headroom and sits well
 * under the true-match mass: high precision, some deliberate misses. The
 * queue is a snack tray, not an inbox — a missed match costs a group shot,
 * a false one costs trust.
 *
 * AI writes ONLY the suggestions table. `persons.name` is written exclusively
 * by the human's confirm (the API route), which is what makes the wall's
 * identities trustworthy.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { nameIsRejected } from "@/lib/faces/cluster-event";
import { NON_PERSON_GALLERIES } from "./index-people";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export const SUGGESTION_CONFIDENCE_FLOOR = 0.55;

export interface MatchHit {
  matched_person_id: string;
  name_key: string;
  name: string;
  face_count: number;
  similarity: number;
}

export interface CrewHit {
  crew_id: string;
  display_name: string;
  similarity: number;
}

/**
 * Crew outrank guests, pure and testable: staff rarely appear in filenames at
 * all (Joey, Justin and Jerrick hold ZERO filename identities archive-wide),
 * so a cluster that looks like crew must be asked as "is this Christie?"
 * BEFORE any filename-derived identity gets a say — Mason's correction,
 * 2026-08-16, looking at Staff Photos' garbled names.
 */
export function decideCrewSuggestion(
  hits: CrewHit[],
  opts: { rejectedNames: string[]; threshold?: number }
): CrewHit | null {
  const threshold = opts.threshold ?? SUGGESTION_CONFIDENCE_FLOOR;
  for (const hit of hits) {
    if (hit.similarity < threshold) return null; // sorted best-first
    if (nameIsRejected(hit.display_name, opts.rejectedNames)) continue;
    return hit;
  }
  return null;
}

/**
 * The judgement, pure and testable: which hit (if any) becomes the
 * suggestion for one anonymous cluster.
 */
export function decideSuggestion(
  hits: MatchHit[],
  opts: {
    /** The cluster's own id — a cluster must never match itself. */
    selfId: string;
    /** Names a human already cleared off this cluster (migration 063). */
    rejectedNames: string[];
    threshold?: number;
  }
): MatchHit | null {
  const threshold = opts.threshold ?? SUGGESTION_CONFIDENCE_FLOOR;
  for (const hit of hits) {
    if (hit.matched_person_id === opts.selfId) continue;
    if (hit.similarity < threshold) return null; // hits arrive sorted best-first
    // A rejected name stays rejected — the same durability contract the
    // consensus namer honours. The next-best hit may still qualify: rejecting
    // "Steven Hughes" must not silence a genuine "Joe Delgado" match.
    if (nameIsRejected(hit.name, opts.rejectedNames)) continue;
    return hit;
  }
  return null;
}

export interface ScanResult {
  eventId: string;
  refreshedCentroids: number;
  anonymousClusters: number;
  suggested: number;
  superseded: number;
  skippedDecided: number;
}

/**
 * Scan ONE event's anonymous clusters. Called by the Inngest lane after
 * clustering and by the archive backfill script. Assumes the reference
 * library exists (the initial full seed ran via the Management API — the
 * full rebuild cannot fit PostgREST's 8s budget); the scoped refresh here
 * folds THIS event's named clusters in, which is also what makes a confirmed
 * suggestion teach the engine.
 */
export async function scanEventForIdentitySuggestions(
  supabase: SupabaseDB,
  userId: string,
  eventId: string,
  opts?: { threshold?: number; skipRefresh?: boolean }
): Promise<ScanResult> {
  let refreshedCentroids = 0;
  if (!opts?.skipRefresh) {
    const { data, error } = await supabase.rpc("refresh_person_reference_centroids", {
      p_user_id: userId,
      p_event_id: eventId,
      // The marketing galleries mint fake people from filenames; the wall
      // excludes them, and so must the reference library — "Golden Gate YPO"
      // was reference material until this list was passed (2026-08-16).
      p_excluded_event_names: [...NON_PERSON_GALLERIES],
    });
    if (error) throw error;
    refreshedCentroids = data ?? 0;
  }

  // This event's anonymous clusters, with the rejection memory.
  type ClusterRow = {
    id: string;
    face_count: number;
    rejected_names: string[] | null;
  };
  const clusters: ClusterRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("persons")
      .select("id, face_count, rejected_names")
      .eq("event_id", eventId)
      .is("name", null)
      .gte("face_count", 2)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    clusters.push(...((data ?? []) as ClusterRow[]));
    if (!data || data.length < 1000) break;
  }

  // Clusters already LINKED to crew are identified — nothing to ask. Without
  // this, the engine would nag about people the crew machinery already knows.
  const crewLinked = new Set<string>();
  if (clusters.length > 0) {
    const ids = clusters.map((c) => c.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await supabase
        .from("crew_persons")
        .select("person_id")
        .in("person_id", ids.slice(i, i + 200));
      if (error) throw error;
      for (const r of data ?? []) crewLinked.add(r.person_id);
    }
  }

  // Existing suggestions: decided ones are settled, pending ones may update.
  const decided = new Set<string>();
  const pendingByPerson = new Map<string, string>(); // person_id → suggestion id
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("person_identity_suggestions")
      .select("id, person_id, status")
      .eq("event_id", eventId)
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const s of data ?? []) {
      if (s.status === "pending") pendingByPerson.set(s.person_id, s.id);
      else decided.add(s.person_id);
    }
    if (!data || data.length < 1000) break;
  }

  // A pending suggestion whose cluster got NAMED some other way (a human used
  // the People view directly) is settled business — supersede, don't re-ask.
  let superseded = 0;
  if (pendingByPerson.size > 0) {
    const { data: named, error } = await supabase
      .from("persons")
      .select("id")
      .in("id", [...pendingByPerson.keys()])
      .not("name", "is", null);
    if (error) throw error;
    for (const n of named ?? []) {
      const { error: upErr } = await supabase
        .from("person_identity_suggestions")
        .update({ status: "superseded", decided_at: new Date().toISOString() })
        .eq("id", pendingByPerson.get(n.id)!);
      if (upErr) throw upErr;
      pendingByPerson.delete(n.id);
      decided.add(n.id);
      superseded += 1;
    }
  }

  let suggested = 0;
  let skippedDecided = 0;
  for (const cluster of clusters) {
    if (decided.has(cluster.id) || crewLinked.has(cluster.id)) {
      skippedDecided += 1;
      continue;
    }
    // CREW FIRST. Staff barely exist in filenames, so the crew reference set
    // is the only path to recognizing them — and a garbled-filename identity
    // ("Marriott Green") must never outrank "is this Christie?".
    const { data: crewHits, error: crewErr } = await supabase.rpc(
      "match_person_cluster_to_crew",
      { p_person_id: cluster.id, p_limit: 3 }
    );
    if (crewErr) throw crewErr;
    const crewBest = decideCrewSuggestion((crewHits ?? []) as CrewHit[], {
      rejectedNames: cluster.rejected_names ?? [],
      threshold: opts?.threshold,
    });
    if (crewBest) {
      const { error: upsertErr } = await supabase.from("person_identity_suggestions").upsert(
        {
          user_id: userId,
          person_id: cluster.id,
          event_id: eventId,
          kind: "crew",
          crew_id: crewBest.crew_id,
          suggested_key: "", // crew have no filename identity — the link is the identity
          suggested_name: crewBest.display_name,
          matched_person_id: null,
          confidence: crewBest.similarity,
          photo_count: cluster.face_count,
          status: "pending",
        },
        { onConflict: "person_id" }
      );
      if (upsertErr) throw upsertErr;
      suggested += 1;
      continue;
    }

    const { data: hits, error } = await supabase.rpc("match_person_cluster", {
      p_person_id: cluster.id,
      p_limit: 3,
    });
    if (error) throw error;
    const best = decideSuggestion((hits ?? []) as MatchHit[], {
      selfId: cluster.id,
      rejectedNames: cluster.rejected_names ?? [],
      threshold: opts?.threshold,
    });
    const existingPendingId = pendingByPerson.get(cluster.id);
    if (!best) {
      // A pending suggestion the engine no longer stands behind (references
      // changed, threshold raised) goes away rather than lingering stale.
      if (existingPendingId) {
        const { error: delErr } = await supabase
          .from("person_identity_suggestions")
          .delete()
          .eq("id", existingPendingId);
        if (delErr) throw delErr;
      }
      continue;
    }
    const { error: upsertErr } = await supabase.from("person_identity_suggestions").upsert(
      {
        user_id: userId,
        person_id: cluster.id,
        event_id: eventId,
        kind: "guest",
        crew_id: null,
        suggested_key: best.name_key,
        suggested_name: best.name,
        matched_person_id: best.matched_person_id,
        confidence: best.similarity,
        photo_count: cluster.face_count,
        status: "pending",
      },
      { onConflict: "person_id" }
    );
    if (upsertErr) throw upsertErr;
    suggested += 1;
  }

  return {
    eventId,
    refreshedCentroids,
    anonymousClusters: clusters.length,
    suggested,
    superseded,
    skippedDecided,
  };
}
