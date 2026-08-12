import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findCrew,
  groupIntoMoments,
  selectMoments,
  type Moment,
} from "./moments";
import {
  countTrainablePicks,
  MIN_PICKS_TO_TRAIN,
  trainHighlightDirection,
} from "./direction";
import { suggestedHighlightCount, typicalRangeFor } from "./limits";

/**
 * Reading an event well enough to propose a Highlights set, and then doing it.
 *
 * Ownership: every read here is owner-scoped. `getAuthUser()` hands back the
 * SERVICE client, which bypasses RLS, so `images`/`sections` (neither of which
 * carries user_id) must be filtered through the event — this is the exact
 * omission that shipped as an IDOR twice.
 */

interface ImageRow {
  id: string;
  r2_key: string;
  taken_at: string | null;
  width: number | null;
  height: number | null;
  original_filename: string | null;
  processing_status: string;
  created_at: string;
  focal_x: number | null;
  focal_y: number | null;
}

/** Page past PostgREST's 1000-row ceiling — lesson 39. */
async function allEventImages(
  supabase: SupabaseClient,
  eventId: string,
  ownerUserId: string
): Promise<ImageRow[]> {
  const out: ImageRow[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("images")
      .select(
        "id, r2_key, taken_at, width, height, original_filename, processing_status, created_at, focal_x, focal_y, events!images_event_id_fkey!inner(user_id)"
      )
      .eq("event_id", eventId)
      .eq("events.user_id", ownerUserId)
      .eq("thumbnail_generated", true)
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as ImageRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export interface HighlightsPlanResult {
  photos: number;
  moments: number;
  collapsed: number;
  people: number | null;
  spanMinutes: number | null;
  recommended: number;
  typical: [number, number];
  indexed: number;
  /** Present only while indexing is incomplete — blocks generation. */
  indexing: { indexed: number; total: number } | null;
  /** False when the photographer has too few past picks to fit a direction. */
  hasDirection: boolean;
  /** Past picks available to learn from — the "learned from your own" story. */
  trainedOnPicks: number;
}

export async function buildHighlightsPlan(
  supabase: SupabaseClient,
  eventId: string,
  ownerUserId: string
): Promise<HighlightsPlanResult> {
  const images = await allEventImages(supabase, eventId, ownerUserId);

  const { count: indexed, error: idxErr } = await supabase
    .from("images")
    .select("id, events!images_event_id_fkey!inner(user_id)", { count: "exact", head: true })
    .eq("event_id", eventId)
    .eq("events.user_id", ownerUserId)
    .not("ai_indexed_at", "is", null);
  if (idxErr) throw idxErr;

  const moments = groupIntoMoments(
    images.map((i) => ({ id: i.id, takenAt: i.taken_at, score: 0 }))
  );
  const collapsed = moments.filter((m) => m.frames.length > 1).length;

  const times = images
    .map((i) => (i.taken_at ? new Date(i.taken_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const spanMinutes = times.length
    ? Math.round((Math.max(...times) - Math.min(...times)) / 60000)
    : null;

  const { count: people } = await supabase
    .from("persons")
    .select("id", { count: "exact", head: true })
    .eq("event_id", eventId);

  // Counts only — see countTrainablePicks. Training here cost 17s cold.
  const trainablePicks = await countTrainablePicks(supabase, ownerUserId, eventId);

  return {
    photos: images.length,
    moments: moments.length,
    collapsed,
    people: people ?? null,
    spanMinutes,
    recommended: suggestedHighlightCount(moments.length),
    typical: typicalRangeFor(moments.length),
    indexed: indexed ?? 0,
    indexing:
      (indexed ?? 0) < images.length
        ? { indexed: indexed ?? 0, total: images.length }
        : null,
    hasDirection: trainablePicks >= MIN_PICKS_TO_TRAIN,
    trainedOnPicks: trainablePicks,
  };
}

export interface ProposedFrame {
  id: string;
  r2Key: string;
  width: number | null;
  height: number | null;
  originalFilename: string;
  processingStatus: string;
  createdAt: string;
  takenAt: string | null;
  focalX: number | null;
  focalY: number | null;
}

export interface ProposedMoment {
  momentId: string;
  rank: number;
  chosenIndex: number;
  frames: ProposedFrame[];
}

export interface ProposeResult {
  proposals: ProposedMoment[];
  totalMoments: number;
  /** How the ordering was produced — surfaced so the UI never over-claims. */
  ranker: "learned" | "unranked";
  trainedOnPicks: number;
  /** People treated as crew and capped in the set. */
  crewFound: number;
}

/**
 * Rank an event's moments and return a pool deeper than the ask, so the review
 * screen can backfill dismissals without another round trip.
 */
export async function proposeHighlights(
  supabase: SupabaseClient,
  eventId: string,
  ownerUserId: string,
  opts: { count: number; coverage: boolean; poolExtra?: number }
): Promise<ProposeResult> {
  const images = await allEventImages(supabase, eventId, ownerUserId);
  if (!images.length) {
    return {
      proposals: [],
      totalMoments: 0,
      ranker: "unranked",
      trainedOnPicks: 0,
      crewFound: 0,
    };
  }

  const direction = await trainHighlightDirection(supabase, ownerUserId, eventId);

  // Score every indexed image against the direction. Paged for the same reason
  // scene-plan pages: an RPC response is capped at 1000 rows like any read.
  const scoreById = new Map<string, number>();
  if (direction) {
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .rpc("score_images_by_embedding", {
          query_embedding: JSON.stringify(direction.vector),
          target_user_id: ownerUserId,
          target_event_id: eventId,
        })
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const row of (data ?? []) as { id: string; similarity: number }[]) {
        scoreById.set(row.id, row.similarity);
      }
      if (!data || data.length < 1000) break;
    }
  }

  // Person membership, for coverage. Absent face data simply means the
  // timeline still spreads the picks.
  const personByImage = new Map<string, string[]>();
  const ids = images.map((i) => i.id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("faces")
      .select("image_id, person_id")
      .in("image_id", ids.slice(i, i + 200))
      .not("person_id", "is", null);
    if (error) throw error;
    for (const f of data ?? []) {
      const k = f.image_id as string;
      const arr = personByImage.get(k) ?? [];
      arr.push(f.person_id as string);
      personByImage.set(k, arr);
    }
  }

  const byId = new Map(images.map((i) => [i.id, i]));
  const moments = groupIntoMoments(
    images.map((i) => ({
      id: i.id,
      takenAt: i.taken_at,
      // Unranked fallback keeps capture order rather than inventing a quality
      // signal — the three scalars we have were measured and do not predict
      // human picks.
      score: scoreById.get(i.id) ?? 0,
      personIds: personByImage.get(i.id) ?? [],
    }))
  );

  // Crew: present across the whole day rather than for one booth visit. On the
  // first live run 29 of 40 picks contained a crew member — the direction is
  // fitted mostly on corporate headshots, so at a kids' activation the people
  // who look most like "a highlight" are the staff in uniform.
  const appearances = new Map<string, number[]>();
  for (const img of images) {
    const t = img.taken_at ? new Date(img.taken_at).getTime() : NaN;
    if (!Number.isFinite(t)) continue;
    for (const p of personByImage.get(img.id) ?? []) {
      const arr = appearances.get(p) ?? [];
      arr.push(t);
      appearances.set(p, arr);
    }
  }
  const allTimes = images
    .map((i) => (i.taken_at ? new Date(i.taken_at).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  const eventSpanMs = allTimes.length
    ? Math.max(...allTimes) - Math.min(...allTimes)
    : 0;
  const crewIds = findCrew(appearances, eventSpanMs);

  const poolSize = Math.min(
    moments.length,
    opts.count + (opts.poolExtra ?? Math.max(20, Math.round(opts.count * 0.75)))
  );
  const picked = selectMoments(moments, poolSize, {
    coverage: opts.coverage,
    crewIds,
  });

  const toFrame = (id: string): ProposedFrame => {
    const r = byId.get(id)!;
    return {
      id: r.id,
      r2Key: r.r2_key,
      width: r.width,
      height: r.height,
      originalFilename: r.original_filename ?? "",
      processingStatus: r.processing_status,
      createdAt: r.created_at,
      takenAt: r.taken_at,
      focalX: r.focal_x,
      focalY: r.focal_y,
    };
  };

  const proposals: ProposedMoment[] = picked.map((m: Moment, i) => ({
    momentId: m.key,
    rank: i + 1,
    chosenIndex: m.bestIndex,
    frames: m.frames.map((f) => toFrame(f.id)),
  }));

  return {
    proposals,
    totalMoments: moments.length,
    ranker: direction ? "learned" : "unranked",
    trainedOnPicks: direction?.trainedOnPicks ?? 0,
    crewFound: crewIds.size,
  };
}
