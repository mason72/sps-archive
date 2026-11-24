import type { SupabaseClient } from "@supabase/supabase-js";
import { WEBSITE_EVENT_SLUG } from "@/lib/site/gallery";
import { EMBEDDING_DIM, parseEmbedding } from "./direction";

/**
 * Headshot galleries rank Highlights by the owner's OWN curated website
 * headshots, not by the learned direction (Mason, 2026-11-23).
 *
 * Why: the learned direction is "what a photographer picked minus the rest of
 * that gallery", i.e. what makes a frame stand out. Highlights are picked for
 * fun and variety, so on a wall of clean portraits "stands out" means props,
 * food, behind-the-scenes gear and off-camera poses. On Electronica 2026 the
 * learned picker chose a mirror prop, a man eating a pepper, a camera rig and
 * a crew member fixing a collar, and no women; ranked by likeness to the
 * headshots Mason curated for twodudesphoto.com, the same gallery's top 72
 * were all clean, camera-facing portraits. Party and event galleries keep the
 * learned direction, where standing out is the point.
 */

/** The owner's website scenes that hold their best headshots. */
export const HEADSHOT_REFERENCE_SCENES = [
  "samples/headshots",
  "slot/hero/headshot-booth",
  "benefits/headshot-booth",
] as const;

/**
 * Share of a gallery's photos with exactly one face at which it counts as a
 * headshot gallery. Measured 2026-11-23 on 12 galleries: headshot lounges
 * 0.92 to 1.00 (Electronica 2026 0.92, Stripe 0.98, eBay 1.00), events and
 * parties 0.06 to 0.28 (Atlassian Expo 0.24, Future of Us 0.28). The cutoff
 * sits in the middle of an empty gap.
 */
export const HEADSHOT_ONE_FACE_SHARE = 0.75;

/** Below this many photos the share means little; the learned path stays. */
export const HEADSHOT_MIN_PHOTOS = 50;

/** Fewer reference photos than this is not a taste, it is a sample. */
export const MIN_REFERENCE_PHOTOS = 20;

export function isHeadshotGallery(faceCounts: number[]): boolean {
  if (faceCounts.length < HEADSHOT_MIN_PHOTOS) return false;
  const one = faceCounts.filter((n) => n === 1).length;
  return one / faceCounts.length >= HEADSHOT_ONE_FACE_SHARE;
}

/** Unit-length mean of the vectors, or null when there are too few. */
export function referenceVector(vectors: Float32Array[]): number[] | null {
  if (vectors.length < MIN_REFERENCE_PHOTOS) return null;
  const sum = new Float64Array(EMBEDDING_DIM);
  for (const v of vectors) for (let i = 0; i < EMBEDDING_DIM; i++) sum[i] += v[i];
  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += sum[i] * sum[i];
  norm = Math.sqrt(norm);
  if (!norm) return null;
  return Array.from(sum, (x) => x / norm);
}

const cache = new Map<string, { at: number; value: number[] | null }>();
const CACHE_MS = 60 * 60 * 1000;
/** "No reference" is remembered briefly, so curating the scenes takes effect soon. */
const NULL_CACHE_MS = 5 * 60 * 1000;

/**
 * The centroid of the owner's website headshots, in the gallery's embedding
 * model, or null when the owner has no website gallery or too few such
 * photos (then the learned path is used). Owner-scoped: the website gallery
 * must belong to `ownerUserId`, so one account's taste never ranks another's.
 */
export async function readHeadshotReference(
  supabase: SupabaseClient,
  ownerUserId: string,
  models: ReadonlySet<string>
): Promise<number[] | null> {
  const key = `${ownerUserId}:${[...models].sort().join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? CACHE_MS : NULL_CACHE_MS)) return hit.value;

  const { data: site, error: siteErr } = await supabase
    .from("events")
    .select("id")
    .eq("slug", WEBSITE_EVENT_SLUG)
    .eq("user_id", ownerUserId)
    .maybeSingle();
  if (siteErr) throw siteErr;
  let value: number[] | null = null;
  if (site) {
    const { data: secs, error: secErr } = await supabase
      .from("sections")
      .select("id")
      .eq("event_id", site.id)
      .in("site_scene_key", [...HEADSHOT_REFERENCE_SCENES]);
    if (secErr) throw secErr;
    const sectionIds = (secs ?? []).map((s) => s.id as string);

    const imageIds = new Set<string>();
    for (let from = 0; sectionIds.length; from += 1000) {
      const { data, error } = await supabase
        .from("section_images")
        .select("section_id, image_id")
        .in("section_id", sectionIds)
        .order("section_id")
        .order("image_id")
        .range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? []) imageIds.add(r.image_id as string);
      if (!data || data.length < 1000) break;
    }

    const ids = [...imageIds];
    const vectors: Float32Array[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      let q = supabase
        .from("images")
        .select("id, siglip_embedding, events!images_event_id_fkey!inner(user_id)")
        .in("id", ids.slice(i, i + 100))
        // Defense in depth: the ids came from the owner's own sections, and
        // only the owner's photos may shape the owner's taste.
        .eq("events.user_id", ownerUserId)
        .not("siglip_embedding", "is", null);
      // Same model as the gallery, or the centroid sits in another space.
      if (models.size) q = q.in("embedding_model", [...models]);
      const { data, error } = await q;
      if (error) throw error;
      for (const r of data ?? []) {
        const v = parseEmbedding((r as { siglip_embedding: unknown }).siglip_embedding);
        if (v) vectors.push(v);
      }
    }
    value = referenceVector(vectors);
  }
  cache.set(key, { at: Date.now(), value });
  return value;
}
