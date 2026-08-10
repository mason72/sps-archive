/**
 * Scene-based section planning (intelligent sections).
 *
 * assignScenes() is pure and tested: given per-image similarities against a
 * taxonomy's labels, produce section membership. Multi-membership is the
 * point — a cake-cutting photo belongs in Reception AND Cake & Desserts.
 *
 * buildScenePlan() orchestrates: embed the taxonomy's prompts (Modal text
 * encoder), score every indexed image against every label (exact scan via
 * the score_images_by_embedding RPC — no ANN approximation), assign, and
 * return a plan shaped exactly like planAutoSections() output so the apply
 * route materializes it through the same auto-section contract.
 *
 * Unassigned images land in a catch-all section so the plan COVERS the whole
 * event — the apply route consumes the "Unsorted" intake afterwards, which is
 * only safe under full coverage.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { taxonomyByKey, type SceneTaxonomy } from "./scene-taxonomies";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Below this raw cosine an image simply isn't any of the scenes. */
export const SCENE_FLOOR = 0.05;
/** Join every label whose debiased score is within this of the image's best. */
export const SCENE_MARGIN = 0.015;
/** Scenes with fewer members than this are dropped (their images fall back). */
export const MIN_SCENE_MEMBERS = 4;
/** The full-coverage catch-all. */
export const CATCH_ALL_NAME = "Everything Else";

export interface ScenePlanSection {
  name: string;
  imageIds: string[];
}

/**
 * @param sims imageId → similarity per label (same order as `labelNames`).
 *
 * Scores are DEBIASED per label (event-mean subtracted) before assignment:
 * a generic label ("portraits" at a wedding, where everything has people)
 * scores warmly everywhere and would swallow the event on raw argmax; after
 * centering, a label only claims images it matches UNUSUALLY well.
 * Multi-membership = labels within SCENE_MARGIN of the image's best.
 */
export function assignScenes(
  sims: Map<string, number[]>,
  labelNames: string[]
): ScenePlanSection[] {
  const members = new Map<string, string[]>(); // label → imageIds
  const unassigned: string[] = [];

  // Per-label event means for debiasing.
  const means = new Array<number>(labelNames.length).fill(0);
  for (const byLabel of sims.values()) {
    byLabel.forEach((sim, i) => {
      means[i] += sim;
    });
  }
  const n = Math.max(1, sims.size);
  for (let i = 0; i < means.length; i++) means[i] /= n;

  for (const [imageId, byLabel] of sims) {
    const rawTop = Math.max(...byLabel);
    if (!(rawTop >= SCENE_FLOOR)) {
      unassigned.push(imageId);
      continue;
    }
    const adjusted = byLabel.map((sim, i) => sim - means[i]);
    const topAdj = Math.max(...adjusted);
    let joined = false;
    adjusted.forEach((adj, i) => {
      if (adj >= topAdj - SCENE_MARGIN && byLabel[i] >= SCENE_FLOOR * 0.8) {
        const list = members.get(labelNames[i]) ?? [];
        list.push(imageId);
        members.set(labelNames[i], list);
        joined = true;
      }
    });
    if (!joined) unassigned.push(imageId);
  }

  // Drop thin scenes; their images fall back to the catch-all unless another
  // surviving scene already holds them.
  const surviving: ScenePlanSection[] = [];
  const dropped: string[] = [];
  for (const name of labelNames) {
    const list = members.get(name) ?? [];
    if (list.length >= MIN_SCENE_MEMBERS) {
      surviving.push({ name, imageIds: list });
    } else {
      dropped.push(...list);
    }
  }
  const covered = new Set(surviving.flatMap((s) => s.imageIds));
  const fallback = [
    ...unassigned,
    ...dropped.filter((id) => !covered.has(id)),
  ].filter((id, i, arr) => arr.indexOf(id) === i && !covered.has(id));

  if (fallback.length) surviving.push({ name: CATCH_ALL_NAME, imageIds: fallback });
  return surviving;
}

/** Scores + plan for an event; throws on config/data problems. */
export async function buildScenePlan(
  supabase: SupabaseDB,
  eventId: string,
  ownerUserId: string,
  taxonomyKey: string
): Promise<{
  taxonomy: SceneTaxonomy;
  plan: ScenePlanSection[];
  indexedCount: number;
}> {
  const taxonomy = taxonomyByKey(taxonomyKey);
  if (!taxonomy) throw new Error(`Unknown taxonomy "${taxonomyKey}"`);
  if (!process.env.MODAL_AI_EMBED_TEXT_URL) throw new Error("AI search is not configured");

  const embedRes = await fetch(process.env.MODAL_AI_EMBED_TEXT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pipeline_key: process.env.VIDEO_PIPELINE_KEY,
      texts: taxonomy.scenes.map((s) => s.prompt),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!embedRes.ok) throw new Error(`embed_text ${embedRes.status}`);
  const { embeddings } = (await embedRes.json()) as { embeddings: number[][] };

  // Score every indexed image against every label — exact, no ANN. PAGED:
  // PostgREST caps RPC responses at 1000 rows like any other read (lesson 39
  // — the first run silently dropped 20 of a wedding's 1,020 images).
  const sims = new Map<string, number[]>();
  for (let li = 0; li < embeddings.length; li++) {
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .rpc("score_images_by_embedding", {
          query_embedding: JSON.stringify(embeddings[li]),
          target_user_id: ownerUserId,
          target_event_id: eventId,
        })
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const row of (data ?? []) as { id: string; similarity: number }[]) {
        const arr = sims.get(row.id) ?? new Array(embeddings.length).fill(-1);
        arr[li] = row.similarity;
        sims.set(row.id, arr);
      }
      if (!data || data.length < 1000) break;
    }
  }

  return {
    taxonomy,
    plan: assignScenes(sims, taxonomy.scenes.map((s) => s.name)),
    indexedCount: sims.size,
  };
}
