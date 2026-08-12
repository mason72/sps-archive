import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The "highlight direction" — a vector in SigLIP space learned from the
 * photographer's OWN past Highlights sections.
 *
 * Why a learned direction and not a quality score: measured against 782 real
 * picks across 13 events, `aesthetic_score` does not predict what a
 * photographer chooses (in 4 of 12 events the picks scored LOWER than the
 * rejects), `sharpness_score` saturates at the top decile, and
 * `is_eyes_open` is true on every face row in the archive. A direction fitted
 * to actual picks reaches ~1.7x random precision@k — weak, but real, and it
 * improves every time a photographer accepts a set.
 * Harness: `scripts/triage/eval-highlight-ranker.ts`.
 *
 * TRAINING centers each event's embeddings on that event's mean before
 * differencing. SigLIP encodes the *scene*, so without centering the model
 * learns "which event is this" — which scores well in-sample for entirely the
 * wrong reason and collapses on a new shoot.
 *
 * SCORING deliberately does NOT center: measured both ways, raw scoring is
 * marginally better (22.2% vs 20.8% mean precision@k), which means the
 * existing `score_images_by_embedding` RPC serves this as-is. Centering only
 * ever mattered for learning.
 */

export const EMBEDDING_DIM = 1152;

/** Below this many picks the direction is noise; callers should fall back. */
export const MIN_PICKS_TO_TRAIN = 30;

/** Unpicked images sampled per training event — the mean converges fast. */
const NEG_SAMPLE_PER_EVENT = 400;

type Vec = Float32Array;

export function parseEmbedding(raw: unknown): Vec | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw.length === EMBEDDING_DIM ? Float32Array.from(raw as number[]) : null;
  }
  if (typeof raw === "string") {
    const t = raw.trim().replace(/^\[|\]$/g, "");
    if (!t) return null;
    const parts = t.split(",");
    if (parts.length !== EMBEDDING_DIM) return null;
    const out = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = +parts[i];
    return out;
  }
  return null;
}

function mean(vs: Vec[]): Vec {
  const m = new Float32Array(EMBEDDING_DIM);
  if (!vs.length) return m;
  for (const v of vs) for (let i = 0; i < EMBEDDING_DIM; i++) m[i] += v[i];
  for (let i = 0; i < EMBEDDING_DIM; i++) m[i] /= vs.length;
  return m;
}

function normalized(v: Vec): Vec {
  let n = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (!n) return v;
  const o = new Float32Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) o[i] = v[i] / n;
  return o;
}

export interface HighlightDirection {
  vector: number[];
  /** Events the direction was fitted on (never includes the target event). */
  trainedOnEvents: number;
  trainedOnPicks: number;
}

/** Warm-lambda cache. Training is read-only, so a stale-by-minutes hit is fine. */
const cache = new Map<string, { at: number; value: HighlightDirection | null }>();
const CACHE_MS = 10 * 60 * 1000;

/**
 * Fit the direction from every Highlights section this user owns, excluding
 * `excludeEventId` — training on the event being ranked would leak the answer
 * and make the eval meaningless.
 *
 * Returns null when the user has too few picks to learn anything.
 */
export async function trainHighlightDirection(
  supabase: SupabaseClient,
  ownerUserId: string,
  excludeEventId: string
): Promise<HighlightDirection | null> {
  const key = `${ownerUserId}:${excludeEventId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  // Owner-scoped: sections carries no user_id, so the join is the filter.
  const { data: secs, error: secErr } = await supabase
    .from("sections")
    .select("id, event_id, events!inner(user_id)")
    .ilike("name", "%highlight%")
    .eq("events.user_id", ownerUserId);
  if (secErr) throw secErr;

  const dirs: Vec[] = [];
  let picksUsed = 0;

  for (const sec of secs ?? []) {
    const eventId = (sec as { event_id: string }).event_id;
    if (eventId === excludeEventId) continue;

    const { data: members, error: mErr } = await supabase
      .from("section_images")
      .select("image_id")
      .eq("section_id", (sec as { id: string }).id)
      .limit(2000);
    if (mErr) throw mErr;
    const pickedIds = (members ?? []).map((m) => m.image_id as string);
    if (pickedIds.length < 5) continue;

    const pos: Vec[] = [];
    for (let i = 0; i < pickedIds.length; i += 100) {
      const { data, error } = await supabase
        .from("images")
        .select("id, siglip_embedding")
        .in("id", pickedIds.slice(i, i + 100))
        .not("ai_indexed_at", "is", null);
      if (error) throw error;
      for (const r of data ?? []) {
        const v = parseEmbedding((r as { siglip_embedding: unknown }).siglip_embedding);
        if (v) pos.push(v);
      }
    }
    if (pos.length < 5) continue;

    const pickedSet = new Set(pickedIds);
    const neg: Vec[] = [];
    for (let from = 0; neg.length < NEG_SAMPLE_PER_EVENT; from += 200) {
      const { data, error } = await supabase
        .from("images")
        .select("id, siglip_embedding")
        .eq("event_id", eventId)
        .not("ai_indexed_at", "is", null)
        .range(from, from + 199);
      if (error) throw error;
      if (!data?.length) break;
      for (const r of data) {
        if (pickedSet.has(r.id as string)) continue;
        const v = parseEmbedding((r as { siglip_embedding: unknown }).siglip_embedding);
        if (v) neg.push(v);
        if (neg.length >= NEG_SAMPLE_PER_EVENT) break;
      }
      if (data.length < 200) break;
    }
    if (neg.length < 20) continue;

    // Center on THIS event's mean, then difference. See the header note.
    const mu = mean([...pos, ...neg]);
    const centre = (v: Vec) => {
      const o = new Float32Array(EMBEDDING_DIM);
      for (let i = 0; i < EMBEDDING_DIM; i++) o[i] = v[i] - mu[i];
      return o;
    };
    const mp = mean(pos.map(centre));
    const mn = mean(neg.map(centre));
    const d = new Float32Array(EMBEDDING_DIM);
    for (let i = 0; i < EMBEDDING_DIM; i++) d[i] = mp[i] - mn[i];
    dirs.push(normalized(d));
    picksUsed += pos.length;
  }

  const value =
    dirs.length && picksUsed >= MIN_PICKS_TO_TRAIN
      ? {
          vector: Array.from(normalized(mean(dirs))),
          trainedOnEvents: dirs.length,
          trainedOnPicks: picksUsed,
        }
      : null;

  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * How many past picks this user could train on — counts only, no embeddings.
 *
 * The plan endpoint needs to know whether a direction is available, not what
 * it is. Training to answer that took 17 seconds on a cold lambda; counting
 * takes one round trip. Fitting the direction belongs behind the generate
 * button, where a spinner is expected.
 */
export async function countTrainablePicks(
  supabase: SupabaseClient,
  ownerUserId: string,
  excludeEventId: string
): Promise<number> {
  const { data: secs, error } = await supabase
    .from("sections")
    .select("id, event_id, events!inner(user_id)")
    .ilike("name", "%highlight%")
    .eq("events.user_id", ownerUserId);
  if (error) throw error;

  let total = 0;
  for (const sec of secs ?? []) {
    if ((sec as { event_id: string }).event_id === excludeEventId) continue;
    const { count, error: cErr } = await supabase
      .from("section_images")
      .select("image_id", { count: "exact", head: true })
      .eq("section_id", (sec as { id: string }).id);
    if (cErr) throw cErr;
    total += count ?? 0;
  }
  return total;
}

/** Drop cached directions for a user — call after a set is accepted. */
export function invalidateDirectionCache(ownerUserId: string): void {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${ownerUserId}:`)) cache.delete(k);
  }
}
