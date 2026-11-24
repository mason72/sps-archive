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
import { isHeadshotGallery, readHeadshotReference } from "./headshot-reference";
import { suggestedHighlightCount, typicalRangeFor } from "./limits";
import {
  bwBaselineNote,
  bwSiblings,
  capTags,
  subjectFaceRows,
  eventCutoffs,
  GROUP_CAP_MAX_SHARE,
  GROUP_SHOT_FACES,
  HIGHLIGHT_CAPS,
  HIGHLIGHT_RULES,
  HIGHLIGHT_VARIETY,
  RELAX_STEPS,
  RULE_KEYS,
  summarizeFaces,
  type RelaxStep,
  vetoReason,
  type FaceRow,
  type FrameFacts,
  type RuleKey,
} from "./rules";
import { embedTexts } from "@/lib/ai-index/embed-text";
import RULE_VECTORS from "./rule-vectors.json";
import { IMPOSTOR_MAX } from "@/lib/faces/calibration";
import { buildStacks } from "@/lib/gallery/stacks";
import { detectStackable } from "@/lib/gallery/stackable";
import { isPersonLike } from "@/lib/sections/auto-plan";
import {
  EVENT_LABEL_MIN_COUNT,
  EVENT_LABEL_MIN_SHARE,
  looksLikeSingleName,
  nameHasSessionWord,
} from "@/lib/people/event-labels";

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
  parsed_name: string | null;
  ai_indexed_at: string | null;
  embedding_model: string | null;
}

/**
 * Every photo of the event, never a cover upload (a client logo; lesson 184:
 * one was picked as a Highlight on 2026-10-15). Pages past PostgREST's
 * 1000-row ceiling — lesson 39.
 */
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
        "id, r2_key, taken_at, width, height, original_filename, processing_status, created_at, focal_x, focal_y, parsed_name, ai_indexed_at, embedding_model, events!images_event_id_fkey!inner(user_id)"
      )
      .eq("event_id", eventId)
      .eq("events.user_id", ownerUserId)
      .eq("thumbnail_generated", true)
      .eq("is_cover_upload", false)
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
  /** "headshots": ranked by the owner's curated website headshots. */
  ranker: "learned" | "headshots" | "unranked";
  trainedOnPicks: number;
  /** People treated as crew and capped in the set. */
  crewFound: number;
  /** Photos each rule kept out of the set (rules.ts): in the propose response and the auto-fill's short-set alert. */
  ruledOut: Record<string, number>;
  /** Taste rules relaxed to fill a short set, in the order applied (rules.ts RELAX_STEPS). */
  relaxed: string[];
  /** Things a person should know about how the rules fit this shoot (e.g. "bw-baseline-high:0.070"). */
  notes: string[];
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
      ruledOut: {},
      relaxed: [],
      notes: [],
    };
  }

  // Faces: how many per frame ("only humans"), how many are SUBJECTS (group
  // shots), and who the subjects are (coverage, one per person). Absent face
  // data simply means the timeline still spreads picks. Read first: the face
  // counts also decide whether this is a headshot gallery.
  const facesByImage = await readFaces(supabase, images.map((i) => i.id));
  const faceSummary = new Map(images.map((i) => [i.id, summarizeFaces(facesByImage.get(i.id) ?? [])]));

  // What "good" means. A headshot gallery ranks by likeness to the owner's
  // curated website headshots (headshot-reference.ts: the learned direction
  // rewards what stands out, which on a wall of portraits is props and odd
  // poses); anything else, or an owner with no such reference, keeps the
  // direction learned from their past Highlights.
  const models = new Set(images.map((i) => i.embedding_model).filter((m): m is string => !!m));
  const headshotGallery = isHeadshotGallery(images.map((i) => faceSummary.get(i.id)!.faces));
  const reference = headshotGallery ? await readHeadshotReference(supabase, ownerUserId, models) : null;
  const direction = reference ? null : await trainHighlightDirection(supabase, ownerUserId, eventId);
  const taste = reference ?? direction?.vector ?? null;

  // The rules (rules.ts) and the taste vector, scored against every
  // indexed photo in ONE call (migration 100): nine paged scans took 8.6 s on
  // Electronica. A failure here THROWS rather than proposing without rules: an
  // unruled set is exactly the complaint, and the auto-fill retries.
  const ruleVectors = await ruleTextVectors(ownerUserId, eventId, models);
  const scored = await scoreByVectors(supabase, [...(taste ? [taste] : []), ...ruleVectors], ownerUserId, eventId);
  const offset = taste ? 1 : 0;
  const scoreById = new Map<string, number>();
  const ruleScores = new Map<string, Partial<Record<RuleKey, number>>>();
  for (const [id, sims] of scored) {
    if (taste) scoreById.set(id, sims[0]);
    const row: Partial<Record<RuleKey, number>> = {};
    RULE_KEYS.forEach((key, i) => (row[key] = sims[offset + i]));
    ruleScores.set(id, row);
  }
  const personByImage = new Map<string, string[]>();
  for (const [id, f] of faceSummary) if (f.subjectPersonIds.length) personByImage.set(id, f.subjectPersonIds);

  const nameKeyById = subjectNameKeys(images);

  // Black-and-white versions of a colour capture first, then the event's
  // baseline from what is left: at a colour+black-and-white booth the versions
  // would otherwise BE the median (third review, 2026-11-16).
  const bwVersions = bwSiblings(
    images.map((i) => ({ id: i.id, capture: i.taken_at, bw: ruleScores.get(i.id)?.bw }))
  );
  const cutoffs = eventCutoffs(
    [...ruleScores.entries()].filter(([id]) => !bwVersions.has(id)).map(([, row]) => row)
  );
  const ruledOut: Record<string, number> = {};
  const facts = new Map<string, FrameFacts>();
  for (const i of images) {
    const s = faceSummary.get(i.id)!;
    const f: FrameFacts = {
      indexed: i.ai_indexed_at != null,
      faces: s.faces,
      subjectFaces: s.subjectFaces,
      scores: ruleScores.get(i.id) ?? {},
    };
    facts.set(i.id, f);
    const why = vetoReason(f, cutoffs) ?? (bwVersions.has(i.id) ? "bw" : null);
    if (why) ruledOut[why] = (ruledOut[why] ?? 0) + 1;
  }

  const byId = new Map(images.map((i) => [i.id, i]));
  // Candidate moments from every frame no (unrelaxed) ban rules out.
  const buildMoments = (relaxedBans: ReadonlySet<string>) =>
    groupIntoMoments(
      images
        .filter((i) => {
          if (bwVersions.has(i.id)) return false;
          return !vetoReason(facts.get(i.id)!, cutoffs, relaxedBans);
        })
        .map((i) => {
          const name = nameKeyById.get(i.id);
          return {
            id: i.id,
            takenAt: i.taken_at,
            // Unranked fallback keeps capture order rather than inventing a
            // quality signal: the three scalars we have were measured and do
            // not predict human picks.
            score: scoreById.get(i.id) ?? 0,
            personIds: [...(personByImage.get(i.id) ?? []), ...(name ? [name] : [])],
            tags: capTags(facts.get(i.id)!, cutoffs),
          };
        })
    );
  const moments = buildMoments(new Set());

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
  const groupShare =
    [...faceSummary.values()].filter((f) => f.subjectFaces >= GROUP_SHOT_FACES).length /
    Math.max(1, images.length);

  // The candidates: a shortlist, not the event, because each one needs its
  // subject faces read to know WHO it is. The top moments by score when
  // ranked, an even spread of the timeline when not (unranked scores are all
  // equal, so "top" would be arbitrary). Only these can be picked: one-per-
  // person is checked face against face, and a photo whose faces were never
  // read cannot be checked (second review, 2026-11-16: cluster ids missed
  // two thirds of Team Curry's faces). Faces are cached by image, so a later
  // round reads only frames it has not seen.
  const faceVecsByImage = new Map<string, number[][]>();
  const shortlistOf = async (ms: Moment[], size: number, exclude: ReadonlySet<string>) => {
    const pool = ms.filter((m) => !exclude.has(m.key));
    const n = Math.min(pool.length, size);
    const list = taste
      ? [...pool].sort((a, b) => b.score - a.score).slice(0, n)
      : timelineSample(pool, n);
    const missing = list.filter((m) => !faceVecsByImage.has(m.frames[m.bestIndex].id));
    for (const [id, v] of await momentFaces(supabase, missing)) faceVecsByImage.set(id, v);
    return list;
  };
  const baseOpts = {
    coverage: opts.coverage,
    crewIds,
    onePerPerson: true,
    facesOf: (m: Moment) => faceVecsByImage.get(m.frames[m.bestIndex].id),
    samePerson: HIGHLIGHT_SAME_PERSON,
    variety: HIGHLIGHT_VARIETY,
  };
  let caps: Record<string, number> =
    groupShare < GROUP_CAP_MAX_SHARE ? { ...HIGHLIGHT_CAPS } : { glasses: HIGHLIGHT_CAPS.glasses };

  const shortlist = await shortlistOf(moments, poolSize * 6, new Set());
  const picked = selectMoments(shortlist, Math.min(poolSize, shortlist.length), { ...baseOpts, caps });

  // Short? Relax the taste rules one at a time, ONLY to fill (Mason,
  // 2026-11-16), continuing from the strict picks so one-per-person and every
  // remaining limit still count them. The strict picks stay first. A short
  // set is refilled up to the full pool (the count plus the swap-in spares
  // the review screen backfills cuts from), and each round searches as deep
  // as the strict round did: the photos a relaxed rule lets in rank BELOW the
  // ones one-per-person already refused (review: a 6x-`need` list added 8
  // fewer picks on Electronica asked for 300).
  const relaxed: RelaxStep[] = [];
  const applied: RelaxStep[] = [];
  const relaxedBans = new Set<string>();
  const poolTarget = opts.count + (opts.poolExtra ?? Math.max(20, Math.round(opts.count * 0.75)));
  const short = picked.length < opts.count;
  for (const step of RELAX_STEPS) {
    if (!short || picked.length >= poolTarget) break;
    if (step === "glasses" || step === "group") {
      if (caps[step] == null) continue; // not in force on this shoot
      caps = { ...caps };
      delete caps[step];
    } else {
      relaxedBans.add(step);
    }
    applied.push(step);
    const need = poolTarget - picked.length;
    const round = await shortlistOf(
      buildMoments(relaxedBans),
      Math.max(need * 6, shortlist.length),
      new Set(picked.map((m) => m.key))
    );
    const extra = selectMoments(round, need, { ...baseOpts, caps, seed: picked });
    if (extra.length) {
      picked.push(...extra);
      // Relaxing is cumulative: everything lifted so far was in force for
      // these photos (a glasses pose can arrive in the group round).
      relaxed.splice(0, relaxed.length, ...applied);
    }
  }

  // A black-and-white baseline this high means a backdrop that reads as black
  // and white (LinkedIn's silver sequins, 0.070) or an all-black-and-white
  // shoot. Diagnostic only, in the response: Mason (2026-11-16) said shoots are
  // all colour or all black and white, mixed ones should keep colour (the
  // sibling test does), so an alert here would fire on normal shoots.
  const notes: string[] = [];
  const bwNote = bwBaselineNote(cutoffs);
  if (bwNote) notes.push(bwNote);

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
    ranker: reference ? "headshots" : direction ? "learned" : "unranked",
    trainedOnPicks: direction?.trainedOnPicks ?? 0,
    crewFound: crewIds.size,
    ruledOut,
    relaxed,
    notes,
  };
}

/**
 * Who each frame is OF by its filename, through the same buildStacks the
 * gallery stacks with, but ONLY when the gallery is a stacked headshot set
 * (detectStackable) and the stack reads like a person by /people's own rules:
 * a full name or a lone first name (any frame count: see below), and never a
 * name carrying a session word ("Name Unknown", "Team Shots": real labels in
 * the archive). Otherwise filenames name cameras
 * or sessions ("IMG_1234", "Guardant_Team-Spirit-Night_13"), and one-per-person
 * on them would leave one photo per camera (review, 2026-11-16). A name covering
 * a big share of the event labels the EVENT, not a person.
 */
export function subjectNameKeys(
  images: { id: string; parsed_name: string | null; original_filename: string | null }[]
): Map<string, string> {
  const out = new Map<string, string>();
  const input = images.map((i) => ({
    id: i.id,
    parsedName: i.parsed_name,
    originalFilename: i.original_filename ?? "",
  }));
  if (!detectStackable(input).stackable) return out;
  for (const st of buildStacks(input)) {
    const n = st.images.length;
    if (!st.key || nameHasSessionWord(st.personName)) continue; // "Name Unknown", "Team Shots"
    // No 60-frame ceiling on a first name here, unlike /people: Luna's sitting
    // is 68 frames, and the ceiling cost her name key and so a second pick. A
    // wrong key only merges a few candidates; a missing one repeats a person.
    if (!isPersonLike(st.personName) && !looksLikeSingleName(st.personName)) continue;
    if (n >= EVENT_LABEL_MIN_COUNT && n / images.length >= EVENT_LABEL_MIN_SHARE) continue;
    for (const img of st.images) out.set(img.id, `name:${st.key}`);
  }
  return out;
}

/**
 * Similarity of every embedded photo in the event to each vector, in one scan
 * and one round trip: score_images_by_vectors (migration 100) returns a single
 * jsonb object, so PostgREST's 1,000-row cap does not page it.
 */
async function scoreByVectors(
  supabase: SupabaseClient,
  vectors: number[][],
  ownerUserId: string,
  eventId: string
): Promise<Map<string, number[]>> {
  const call = () =>
    supabase.rpc("score_images_by_vectors", {
      query_embeddings: vectors,
      target_user_id: ownerUserId,
      target_event_id: eventId,
    });
  let { data, error } = await call();
  // One retry on a statement timeout: a cold 34,000-photo event measured ~18 s
  // against the 15 s limit and 2.8 s once its pages were warm (review).
  if (error?.code === "57014") ({ data, error } = await call());
  if (error) throw error;
  const out = new Map<string, number[]>();
  for (const [id, sims] of Object.entries((data ?? {}) as Record<string, number[]>)) {
    if (!Array.isArray(sims) || sims.length !== vectors.length) {
      throw new Error(`score_images_by_vectors: ${id} has ${sims?.length} scores for ${vectors.length} vectors`);
    }
    out.set(id, sims);
  }
  return out;
}

/**
 * The rule phrases as text vectors. Stored in rule-vectors.json (written by
 * scripts/highlights-rule-vectors.ts) because the embedding service cost 28 s
 * cold on every propose (2026-11-16). Used only when every phrase matches the
 * stored text AND every indexed photo carries the stored model; otherwise a
 * live embed, kept per warm server. A reply with the wrong number of vectors
 * is an error, not a partial rule set.
 */
let ruleVectorCache: { key: string; vectors: number[][] } | null = null;
async function ruleTextVectors(
  ownerUserId: string,
  eventId: string,
  eventModels: Set<string>
): Promise<number[][]> {
  const texts = RULE_KEYS.map((k) => HIGHLIGHT_RULES[k].text);
  const stored = storedRuleVectors(texts, eventModels);
  if (stored) return stored;
  const key = texts.join("\n");
  if (ruleVectorCache?.key === key) return ruleVectorCache.vectors;
  const vectors = await embedTexts(texts, { userId: ownerUserId, eventId, purpose: "highlights" });
  if (vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v) || !v.length)) {
    throw new Error(`highlight rules: embed_text returned ${vectors.length} vectors for ${texts.length} phrases`);
  }
  ruleVectorCache = { key, vectors };
  return vectors;
}

/** The stored vectors, or null when a phrase or the model no longer matches. */
export function storedRuleVectors(texts: string[], eventModels: Set<string>): number[][] | null {
  const file = RULE_VECTORS as { model: string; phrases: Record<string, { text: string; vector: number[] }> };
  if ([...eventModels].some((m) => m !== file.model)) return null;
  const out: number[][] = [];
  for (const [i, key] of RULE_KEYS.entries()) {
    const entry = file.phrases[key];
    if (!entry || entry.text !== texts[i] || entry.vector.length !== 1152) return null;
    out.push(entry.vector);
  }
  return out;
}

type FaceRead = FaceRow & { image_id: string; embedding?: unknown };

/**
 * Every face row for these images, PAGED: a chunk of 100 party frames can hold
 * more than PostgREST's 1,000-row ceiling, and a silently cut read turns real
 * faces into "no face" vetoes (review, 2026-11-16). Chunked at 100 ids because
 * a long in() list fails as a URL.
 */
export async function readFaces(
  supabase: SupabaseClient,
  imageIds: string[],
  columns = "id, image_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h"
): Promise<Map<string, FaceRead[]>> {
  const out = new Map<string, FaceRead[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < imageIds.length; i += 100) chunks.push(imageIds.slice(i, i + 100));
  // Six chunks at a time: fifty sequential reads took 6.1 s on Electronica.
  // Small indexed lookups, so the parallelism is cheap for the database.
  let next = 0;
  let failed = false;
  const worker = async () => {
    try {
      for (let c = next++; c < chunks.length && !failed; c = next++) await readChunk(chunks[c]);
    } catch (e) {
      failed = true; // stop the other workers querying a database that is failing
      throw e;
    }
  };
  const readChunk = async (chunk: string[]) => {
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from("faces")
        .select(columns)
        .in("image_id", chunk)
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      const rows = (data ?? []) as unknown as FaceRead[];
      for (const r of rows) {
        const arr = out.get(r.image_id) ?? [];
        arr.push(r);
        out.set(r.image_id, arr);
      }
      if (rows.length < 1000) break;
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, chunks.length) }, worker));
  return out;
}

/**
 * "The same person" for never-twice: any face match ABOVE the highest
 * similarity ever measured between two different people, not FACE_MATCH_FLOOR
 * (0.55, which is for naming faces). Team Curry's host kissing in profile
 * matched her own frontal pair photo at 0.434 and got in twice under 0.55
 * (found on production, 2026-11-16). Erring here costs a slot, never a repeat.
 */
export const HIGHLIGHT_SAME_PERSON = IMPOSTOR_MAX;

/** ArcFace face vectors in this archive (faces.embedding). */
const FACE_VECTOR_DIM = 512;

/**
 * An even sample of `size` moments across the whole timeline (moments arrive
 * in capture order). A stride with a slice cut the END of the event off whenever
 * the count did not divide evenly: 800 moments into 420 kept only the first 53%.
 */
export function timelineSample<M>(moments: M[], size: number): M[] {
  const n = moments.length;
  if (size >= n) return [...moments];
  return Array.from({ length: size }, (_, i) => moments[Math.floor((i * n) / size)]);
}

/**
 * The SUBJECT faces of each moment's chosen frame, keyed by IMAGE id, largest first, as unit
 * vectors (ArcFace, 512 numbers). Subjects by the same size rule as
 * summarizeFaces, so "who the photo is of" means one thing everywhere.
 */
async function momentFaces(
  supabase: SupabaseClient,
  moments: Moment[]
): Promise<Map<string, number[][]>> {
  const ids = [...new Set(moments.map((m) => m.frames[m.bestIndex].id))];
  const rows = await readFaces(
    supabase,
    ids,
    "id, image_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, embedding"
  );
  const out = new Map<string, number[][]>();
  for (const [imageId, faces] of rows) {
    const vecs = subjectFaceRows(faces)
      .filter((f) => f.embedding != null)
      .map((f) => {
        const raw = typeof f.embedding === "string" ? (JSON.parse(f.embedding) as number[]) : (f.embedding as number[]);
        // A vector of another length would compare as NaN, and NaN never
        // matches: the same person would pass as a stranger. Fail loudly.
        if (raw.length !== FACE_VECTOR_DIM) {
          throw new Error(`highlights: face vector has ${raw.length} numbers, expected ${FACE_VECTOR_DIM}`);
        }
        const norm = Math.hypot(...raw) || 1;
        return raw.map((x) => x / norm);
      });
    if (vecs.length) out.set(imageId, vecs);
  }
  return out;
}
