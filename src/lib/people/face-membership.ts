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
export async function loadFaceMembership(
  supabase: SupabaseDB,
  eventIds: string[]
): Promise<FaceMembership> {
  const membership: FaceMembership = new Map();
  if (eventIds.length === 0) return membership;

  // Named clusters only. An anonymous cluster knows a face recurs but not
  // whose it is, so it can't attach to an identity yet.
  const keyByPersonId = new Map<string, string>();
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("persons")
      .select("id, name")
      .in("event_id", eventIds)
      .not("name", "is", null)
      // Paged reads ORDER BY, always — see lesson 88. An unpaged select also
      // caps silently at 1,000 rows, and a truncated read is indistinguishable
      // from a real absence (that bit the probe that measured this feature).
      .order("id")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const p of data ?? []) {
      const key = normalizeNameKey(p.name ?? "");
      if (key) keyByPersonId.set(p.id, key);
    }
    if (!data || data.length < 1000) break;
  }
  if (keyByPersonId.size === 0) return membership;

  // Count faces per (cluster, image) so the contamination guard above can fire.
  //
  // Chunks run CONCURRENTLY — serially this was 3.9s of a 5.0s /people build,
  // and each chunk is independent. Pages *within* a chunk stay sequential
  // because the page count isn't known ahead of time; that is fine, since the
  // chunks are what there are many of.
  const faceCount = new Map<string, number>();
  const personIds = [...keyByPersonId.keys()];
  const CHUNK = 200; // keep the `in` list well inside PostgREST's URL limits
  const slices: string[][] = [];
  for (let i = 0; i < personIds.length; i += CHUNK) {
    slices.push(personIds.slice(i, i + CHUNK));
  }
  const chunkResults = await Promise.all(
    slices.map(async (slice) => {
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
    })
  );
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
