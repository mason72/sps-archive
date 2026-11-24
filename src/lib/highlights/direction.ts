import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readAllRows } from "@/lib/supabase/paged";

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
const NEG_SAMPLE_PER_EVENT = 200;

/**
 * Which past Highlights sections are worth learning from (2026-09-24).
 *
 * The learner was built on 13 events / 782 picks. The Pixieset migration took
 * it to 288 sections / 46,095 picks, and a fit then read ~a gigabyte of
 * embeddings and died on the statement timeout — the manual generator and the
 * auto-fill alike. Worse, 56 of the 73 native sections held MORE THAN HALF their
 * gallery (the old "the upload dump lands in Highlights" behaviour): not picks.
 *
 *   MAX_KEEP_SHARE      a section holding more of its event than this is a dump,
 *                       judged from the first page of the gallery and skipped
 *                       before its picks' embeddings are read. Real keep rates
 *                       measured 2.4%–17.9% (limits.ts OBSERVED_KEEP_RANGE).
 *   MAX_TRAIN_SECTIONS  most recent qualifying sets only — the method was
 *                       validated on 13, and recent taste is the taste.
 *   MAX_PICKS_PER_SECTION  one big gallery must not outvote the rest.
 *
 * The sizes (20 sets x 100 picks + 200 unpicked) keep a fit at ~6,000
 * embeddings, the scale it was validated at. 40 x (200 + 400) was ~24,000 and
 * took 5 minutes under load: the disk, not the CPU, is what a fit costs.
 */
export const MAX_KEEP_SHARE = 0.25;
export const MAX_TRAIN_SECTIONS = 20;
export const MAX_PICKS_PER_SECTION = 100;

interface TrainableSection {
  id: string;
  eventId: string;
  /** Picks in the section (uncapped). */
  picks: number;
}

/**
 * The newest past Highlights sets worth reading, by PICK COUNT only. Whether a
 * set is a dump (picks > MAX_KEEP_SHARE of its gallery) is decided during
 * training from the unpicked sample it reads anyway: counting a gallery's
 * photos is a count on the hot `images` table (5s each under migration load,
 * measured 2026-09-24), which is exactly what timed the learner out.
 */
/**
 * Past sets, newest WORK first: by the date the event happened, falling back
 * to the creation date for an undated gallery.
 *
 * It used to be the creation date alone. On 2026-11-23 that meant the
 * Pixieset migration's 1,028 galleries from 2014-2023, all created Oct 30-31
 * 2026, filled the candidate window; almost all were dumps (every photo in
 * "Highlights") and were rightly skipped, which left TWO real sets to learn
 * from, one of them event coverage. The picker then filled Electronica
 * 2026's headshot Highlights with candid, off-camera frames and no women,
 * while 15 hand-picked 2026 sets sat outside the window.
 */
export function orderTrainingCandidates(
  rows: { id: string; event_id: string; events: { event_date: string | null; created_at: string } | null }[]
): { id: string; eventId: string }[] {
  return rows
    .map((r) => ({
      id: r.id,
      eventId: r.event_id,
      // Undated: the creation date. Measured 2026-11-23: all 1,041 migrated
      // sets carry an event date; only 6 native ones (samples, workspaces) are
      // undated, and for those "made recently" is the honest guess.
      at: r.events?.event_date ?? r.events?.created_at?.slice(0, 10) ?? "",
    }))
    .sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
    .map(({ id, eventId }) => ({ id, eventId }));
}

async function candidateSections(
  supabase: SupabaseClient,
  ownerUserId: string,
  excludeEventId: string,
  limit: number
): Promise<TrainableSection[]> {
  // Owner-scoped: sections carries no user_id, so the join is the filter.
  // Paged: there are over 1,000 such sections since the Pixieset migration,
  // and an unpaged read stops at 1,000 with no error.
  const raw = await readAllRows(() =>
    supabase
      .from("sections")
      .select("id, event_id, events!inner(user_id, created_at, event_date)")
      .ilike("name", "%highlight%")
      // Machine-filled sections (migration 086) are the generator's own output;
      // learning from them would teach it to agree with itself.
      .is("highlights_auto_count", null)
      .eq("events.user_id", ownerUserId)
      .neq("event_id", excludeEventId)
  );

  // A many-to-one embed arrives as one object at runtime; the generated
  // types call it an array, so the shape is asserted here (as before).
  const secs = raw.map((r) => ({
    id: r.id as string,
    event_id: r.event_id as string,
    events: r.events as unknown as { event_date: string | null; created_at: string } | null,
  }));
  const ordered = orderTrainingCandidates(secs);

  const out: TrainableSection[] = [];
  for (let i = 0; i < ordered.length && out.length < limit; i += 20) {
    const counted = await Promise.all(
      ordered.slice(i, i + 20).map(async (c) => {
        const { count, error: cErr } = await supabase
          .from("section_images")
          .select("image_id", { count: "exact", head: true })
          .eq("section_id", c.id);
        if (cErr) throw cErr;
        return { id: c.id, eventId: c.eventId, picks: count ?? 0 };
      })
    );
    for (const c of counted) if (c.picks >= 5 && out.length < limit) out.push(c);
  }
  return out;
}

/** Pages of unpicked images read per set before judging it (200 rows each). */
const MAX_NEG_PAGES = 2;

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

  // Twice the target, because dumps are only recognised while reading.
  const secs = await candidateSections(
    supabase,
    ownerUserId,
    excludeEventId,
    MAX_TRAIN_SECTIONS * 2
  );

  // A stored result for exactly these sets (migration 101): fitting reads ~6,000
  // embeddings, 10 s cold on every propose (2026-11-16), and only changes when a
  // Highlights section somewhere changes. A store that cannot be read means
  // "train", never "fail".
  const signature = directionSignature(ownerUserId, secs);
  const stored = await readStoredDirection(supabase, signature);
  if (stored !== undefined) {
    cache.set(key, { at: Date.now(), value: stored });
    return stored;
  }

  const dirs: Vec[] = [];
  let picksUsed = 0;
  let unindexed = 0;

  // One past set -> its direction, or null when it is not worth learning from.
  const fitOne = async (sec: TrainableSection): Promise<{ dir: Vec; picks: number } | null> => {
      const eventId = sec.eventId;

      const { data: members, error: mErr } = await supabase
        .from("section_images")
        .select("image_id")
        .eq("section_id", sec.id)
        .order("image_id")
        .limit(MAX_PICKS_PER_SECTION);
      if (mErr) throw mErr;
      const pickedIds = (members ?? []).map((m) => m.image_id as string);
      if (pickedIds.length < 5) return null;

      // Membership of the WHOLE set (ids only, cheap) — the embeddings above
      // were capped, but judging "is this picked" needs every pick.
      const pickedSet = new Set(pickedIds);
      if (sec.picks > pickedIds.length) {
        for (let from = 0; from < sec.picks; from += 1000) {
          const { data, error } = await supabase
            .from("section_images")
            .select("image_id")
            .eq("section_id", sec.id)
            .order("image_id")
            .range(from, from + 999);
          if (error) throw error;
          for (const r of data ?? []) pickedSet.add(r.image_id as string);
          if (!data || data.length < 1000) break;
        }
      }
      const neg: Vec[] = [];
      let scanned = 0;
      let scannedPicked = 0;
      for (let page = 0; page < MAX_NEG_PAGES && neg.length < NEG_SAMPLE_PER_EVENT; page++) {
        const { data, error } = await supabase
          .from("images")
          .select("id, siglip_embedding")
          .eq("event_id", eventId)
          .not("ai_indexed_at", "is", null)
          // (event_id, created_at) is indexed; ordering by id alone forced a
          // whole-gallery sort, 7s on a 19k gallery. Upload order can cluster
          // picks early, which only ever makes a real set look like a dump:
          // a skipped set, never a learned dump.
          .order("created_at")
          .order("id")
          .range(page * 200, page * 200 + 199);
        if (error) throw error;
        if (!data?.length) break;
        for (const r of data) {
          scanned++;
          if (pickedSet.has(r.id as string)) {
            scannedPicked++;
            continue;
          }
          if (neg.length >= NEG_SAMPLE_PER_EVENT) continue;
          const v = parseEmbedding((r as { siglip_embedding: unknown }).siglip_embedding);
          if (v) neg.push(v);
        }
        // A dump announces itself on the first page; stop paying for it.
        if (scanned && scannedPicked / scanned > MAX_KEEP_SHARE) break;
        if (data.length < 200) break;
      }
      if (!scanned || scannedPicked / scanned > MAX_KEEP_SHARE) return null;
      // Too few embedded photos is "not indexed yet", not "not a real set":
      // still skipped for this fit, but the fit is then not stored, or a
      // just-migrated gallery would stay out until some pick count changed.
      if (neg.length < 20) {
        unindexed++;
        return null;
      }

      // Only now, with the set judged a real one, read the picks' embeddings.
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
      if (pos.length < 5) {
        unindexed++;
        return null;
      }

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
      return { dir: normalized(d), picks: pos.length };
  };

  // Three sets at a time, newest first, until enough real sets are fitted.
  // One at a time took 5.5 minutes under migration load (2026-09-24); six at a
  // time pushed single reads past the 15s statement timeout. A set whose read
  // fails is skipped — one lost example must not sink the whole fit — and the
  // fit only fails when every set did.
  let failed = 0;
  let attempted = 0;
  let firstError: unknown = null;
  for (let i = 0; i < secs.length && dirs.length < MAX_TRAIN_SECTIONS; i += 3) {
    const fitted = await Promise.allSettled(secs.slice(i, i + 3).map(fitOne));
    attempted += fitted.length;
    for (const f of fitted) {
      if (f.status === "rejected") {
        failed++;
        firstError ??= f.reason;
        continue;
      }
      if (!f.value || dirs.length >= MAX_TRAIN_SECTIONS) continue;
      dirs.push(f.value.dir);
      picksUsed += f.value.picks;
    }
  }
  // Fail only when EVERY set failed. Sets declined as dumps are not failures:
  // they fall through to "no direction", which propose reports as unranked.
  if (failed && failed === attempted) throw firstError;
  if (failed) {
    const { reportSystemError } = await import("@/lib/monitoring/report");
    await reportSystemError("highlights.direction.partial", firstError, {
      ownerUserId,
      failedSets: failed,
      fittedSets: dirs.length,
    });
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
  // Only a COMPLETE fit is stored: one with failed sets is a partial answer,
  // fine for this propose, wrong to keep until a section changes.
  if (!failed && !unindexed) await storeDirection(supabase, signature, ownerUserId, value);
  return value;
}

/**
 * Bump when the TRAINING changes (constants, centring, the dump rule) or the
 * photo embedding model changes (a re-embed puts every photo in a new space),
 * so every stored direction is retrained instead of serving an old answer.
 */
export const DIRECTION_TRAINER_VERSION = 2;

/**
 * Exactly what a fit depends on: the owner, the candidate sets in order, and
 * how many picks each holds. An edit to any Highlights section changes a count
 * (or the set list) and so the signature. A swap that keeps the count does not,
 * which leaves the direction one set's edit behind until the next count change;
 * accepted, because it is still a direction learned from this owner's picks.
 */
export function directionSignature(
  ownerUserId: string,
  secs: { id: string; picks: number }[]
): string {
  const body = [
    `v${DIRECTION_TRAINER_VERSION}`,
    `${MAX_TRAIN_SECTIONS}/${MAX_PICKS_PER_SECTION}/${NEG_SAMPLE_PER_EVENT}/${MAX_KEEP_SHARE}/${MIN_PICKS_TO_TRAIN}/${MAX_NEG_PAGES}`,
    ownerUserId,
    ...secs.map((s) => `${s.id}:${s.picks}`),
  ].join("|");
  return createHash("sha256").update(body).digest("hex");
}

/** The stored direction for a signature: a value or null when stored, undefined when not stored or unreadable. */
async function readStoredDirection(
  supabase: SupabaseClient,
  signature: string
): Promise<HighlightDirection | null | undefined> {
  const { data, error } = await supabase
    .from("highlight_directions")
    .select("vector, trained_on_events, trained_on_picks")
    .eq("signature", signature)
    .maybeSingle();
  if (error || !data) return undefined;
  const v = data.vector as number[] | null;
  if (!v) return null;
  if (v.length !== EMBEDDING_DIM) return undefined;
  return {
    vector: v,
    trainedOnEvents: data.trained_on_events as number,
    trainedOnPicks: data.trained_on_picks as number,
  };
}

async function storeDirection(
  supabase: SupabaseClient,
  signature: string,
  ownerUserId: string,
  value: HighlightDirection | null
): Promise<void> {
  const { error } = await supabase.from("highlight_directions").upsert({
    signature,
    owner_user_id: ownerUserId,
    vector: value?.vector ?? null,
    trained_on_events: value?.trainedOnEvents ?? 0,
    trained_on_picks: value?.trainedOnPicks ?? 0,
  });
  if (error) {
    const { reportSystemError } = await import("@/lib/monitoring/report");
    await reportSystemError("highlights.direction.store", error, { ownerUserId });
  }
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
  // An upper bound: dumps are only recognised while training (see
  // candidateSections), so this can promise a direction that training then
  // declines. proposeHighlights handles that as "unranked", never as an error.
  const secs = await candidateSections(supabase, ownerUserId, excludeEventId, MAX_TRAIN_SECTIONS);
  return secs.reduce((sum, s) => sum + Math.min(s.picks, MAX_PICKS_PER_SECTION), 0);
}

/** Drop cached directions for a user — call after a set is accepted. */
export function invalidateDirectionCache(ownerUserId: string): void {
  for (const k of [...cache.keys()]) {
    if (k.startsWith(`${ownerUserId}:`)) cache.delete(k);
  }
}
