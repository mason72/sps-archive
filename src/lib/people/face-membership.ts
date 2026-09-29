/**
 * "Who is IN this photo", from the face clusters — the other half of People
 * membership.
 *
 * `personKeyForImage()` answers a different question: whose SHOOT a frame came
 * from, read off the filename. That is right for a headshot day and blind to
 * group shots, which carry at most one person's name (usually nobody's). A
 * group shot appearing on several people's cards is the point of this module,
 * not a bug in it.
 *
 * ONE home, deliberately. The index counts the tile, `buildPersonDetail` fills
 * the card, and the `?person=` deep link opens the event — all three must agree
 * on membership or the tile promises photos the card can't show. That exact
 * disagreement shipped once already (an unordered paged scan double-counting,
 * lesson 88); a second predicate would reintroduce it by design.
 *
 * Measured before building (`scripts/triage/group-shot-gain.ts`, 2026-08-16):
 * 7,592 photos hold 2+ faces, but only 1.9% of the faces in them belong to a
 * NAMED cluster — 80.3% sit in anonymous ones, because clusters are named by
 * filename consensus and the group-heavy galleries name nobody. So this adds
 * ~356 photos today. It is the foundation for the naming work, not the payoff:
 * every identity confirmed later flows onto the cards through here with no
 * further wiring.
 */
import type { createServiceClient } from "@/lib/supabase/server";

import { normalizeNameKey } from "./index-people";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** personKey → image ids that person's face was clustered into. */
export type FaceMembership = Map<string, Set<string>>;

/**
 * Every named cluster's images, keyed by identity, across the given events.
 *
 * Two faces from ONE cluster in ONE photo means the cluster is contaminated —
 * a person appears once in a frame, so one of those faces belongs to somebody
 * else. Measured live: Steven Hughes's cluster holds 203 faces across 184
 * photos, so ~19 frames carry two "Steven" faces and at most one is him. We
 * cannot tell which, so those frames are DROPPED rather than guessed at: this
 * function only ever ADDS photos to a card, and a wrong add puts a stranger on
 * someone's page. Frames the filename already attributes are unaffected —
 * they never travel through here.
 */
/** `.in()` values ride in the URL; 200 UUIDs is ~7.5 KB, well inside PostgREST's limit. */
const IN_CHUNK = 200;
/** Requests in flight at once. Fixed on purpose: it must never track the data size. */
const FACE_CONCURRENCY = 4;

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export async function loadFaceMembership(
  supabase: SupabaseDB,
  eventIds: string[],
  /**
   * Only these identity keys. The spotlight shows ONE person, and reading the
   * faces of all 26,236 named clusters to answer for one of them took 79 s
   * against a 60 s route (2026-09-29). The contamination guard is per
   * (cluster, photo), so dropping other clusters cannot change the answer for
   * the ones kept.
   */
  onlyKeys?: ReadonlySet<string>
): Promise<FaceMembership> {
  const membership: FaceMembership = new Map();
  if (eventIds.length === 0) return membership;

  // Named clusters only. An anonymous cluster knows a face recurs but not
  // whose it is, so it can't attach to an identity yet.
  //
  // Galleries go in IN_CHUNK at a time. PostgREST puts `.in()` values in the
  // URL, and the whole archive's ids (606 on 2026-09-29) made a 23,578-character
  // request that failed on a header overflow in 2 s: every /people rebuild and
  // every spotlight since mid-September (lesson 172).
  const keyByPersonId = new Map<string, string>();
  for (let i = 0; i < eventIds.length; i += IN_CHUNK) {
    const chunk = eventIds.slice(i, i + IN_CHUNK);
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from("persons")
        .select("id, name")
        .in("event_id", chunk)
        .not("name", "is", null)
        // Paged reads ORDER BY, always — see lesson 88. An unpaged select also
        // caps silently at 1,000 rows, and a truncated read is indistinguishable
        // from a real absence (that bit the probe that measured this feature).
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const p of data ?? []) {
        const key = normalizeNameKey(p.name ?? "");
        if (key && (!onlyKeys || onlyKeys.has(key))) keyByPersonId.set(p.id, key);
      }
      if (!data || data.length < 1000) break;
    }
  }

  if (keyByPersonId.size === 0) return membership;

  // Count faces per (cluster, image) so the contamination guard above can fire.
  //
  // Chunks run through a pool of FACE_CONCURRENCY. Serially this was 3.9s of a
  // 5.0s /people build; one request per chunk ALL AT ONCE was 132 simultaneous
  // requests at 26,236 named clusters, the same fan-out that exhausted the API
  // pool on 2026-09-28 (lesson 172). The pool's width is fixed; the archive's
  // size only changes how long it runs. Pages *within* a chunk stay sequential
  // because the page count isn't known ahead of time.
  const faceCount = new Map<string, number>();
  const personIds = [...keyByPersonId.keys()];
  const slices: string[][] = [];
  for (let i = 0; i < personIds.length; i += IN_CHUNK) {
    slices.push(personIds.slice(i, i + IN_CHUNK));
  }
  const chunkResults = await mapWithConcurrency(slices, FACE_CONCURRENCY, async (slice) => {
    const rows: { image_id: string; person_id: string | null }[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from("faces")
        .select("image_id, person_id")
        .in("person_id", slice)
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    return rows;
  });
  for (const rows of chunkResults) {
    for (const f of rows) {
      if (!f.person_id) continue;
      const pair = `${f.person_id}|${f.image_id}`;
      faceCount.set(pair, (faceCount.get(pair) ?? 0) + 1);
    }
  }

  for (const [pair, count] of faceCount) {
    if (count > 1) continue; // contaminated — see the doc comment above
    const [personId, imageId] = pair.split("|");
    const key = keyByPersonId.get(personId);
    if (!key) continue;
    const set = membership.get(key) ?? new Set<string>();
    set.add(imageId);
    membership.set(key, set);
  }

  return membership;
}
