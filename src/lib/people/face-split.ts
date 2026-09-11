/**
 * A shared name is not a shared person — faces decide (2026-09-11).
 *
 * The index keys identity on the NAME its filenames carry, so every "Alex" in
 * the archive was one card: five different men, ranked #1 on the Wall of Fame
 * (Mason: "they are totally different people"). Measured the same day over
 * every identity spanning 2+ events, comparing the faces filed under the name
 * in each event: one-word names 72 one person / 34 several; full names 506 /
 * 13 (two Jessica Johnsons, two Manish Patels). Of 709 event pairs, 632
 * matched and 77 did not, and NONE fell between the impostor ceiling and the
 * match floor — so this is a clean signal, not a judgement call.
 *
 * The rule: events whose faces match are one person; events whose faces don't
 * are separate cards. An event with no usable face (group shots only) joins
 * the largest card — the old behaviour, and the safe default. A human's word
 * still wins: "Same person as…" between two split cards writes a row in
 * person_split_links (migration 080) — a pair of EVENTS under the name — and
 * that pair is a forced link on every rebuild. It is deliberately not an alias
 * row: the alias table is the name resolver, and card keys are derived (they
 * move when photos land), so storing merges on them re-keyed whole names and
 * orphaned merges in the first draft (caught in review).
 *
 * The largest group keeps the base key, so exclusions and deep links made
 * before this existed keep pointing at the card they meant.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { FACE_MATCH_FLOOR } from "@/lib/faces/calibration";

import type { IndexedPerson } from "./index-people";

// NO server-only runtime imports in this file. index-people.ts imports it,
// and index-people is also imported by a CLIENT page (events/[eventId]) for
// its name helpers — pulling the error reporter in here dragged next/headers
// into the browser bundle and failed the production build (2026-09-11). The
// caller injects how to report instead (SplitErrorHandler).

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** How a split failure is reported. Absent → the error is thrown (scripts see it). */
export type SplitErrorHandler = (err: unknown, detail: Record<string, unknown>) => Promise<void>;

export interface FaceSample {
  id: string;
  score: number;
}

/** name key → human-confirmed [eventA, eventB] "same person" pairs. */
export type SplitLinks = ReadonlyMap<string, [string, string][]>;

/** Frames compared per (identity, event): the best-scored filename frames. */
export const SAMPLES_PER_EVENT = 5;
/**
 * Comparisons per database call. PostgREST's row cap (db-max-rows, 1,000)
 * applies to function results too, and a truncated result would silently drop
 * links — splitting one person in two. Batches stay under it, and a result AT
 * the cap is treated as an error rather than trusted.
 */
const MAX_PAIRS_PER_CALL = 900;
const ROW_CAP = 1000;

/** The label one identity's frames in one event travel under. Keys are [a-z] only, so "|" cannot collide. */
export const sampleKey = (personKey: string, eventId: string) => `${personKey}|${eventId}`;

/** A split card's key — unique per group; not meant to be stored (merges anchor to events). */
export const splitKey = (baseKey: string, eventIds: string[]) =>
  `${baseKey}~${[...eventIds].sort()[0]}`;

/**
 * Pure: one identity's events → groups of events that are one person.
 * `sims` holds only pairs where BOTH events had a usable face. `links` are a
 * human's "same person" pairs and always join. An event in neither has no
 * evidence and joins the largest group.
 */
export function groupEventsByFace(
  eventIds: string[],
  photosByEvent: ReadonlyMap<string, number>,
  sims: { a: string; b: string; sim: number }[],
  links: [string, string][] = [],
  floor: number = FACE_MATCH_FLOOR
): string[][] {
  const inIdentity = new Set(eventIds);
  const usable = links.filter(([a, b]) => inIdentity.has(a) && inIdentity.has(b));
  const nodes = new Set<string>();
  for (const s of sims) {
    nodes.add(s.a);
    nodes.add(s.b);
  }
  for (const [a, b] of usable) {
    nodes.add(a);
    nodes.add(b);
  }
  if (nodes.size < 2) return [eventIds];

  const parent = new Map<string, string>();
  for (const e of nodes) parent.set(e, e);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const join = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const s of sims) if (s.sim >= floor) join(s.a, s.b);
  for (const [a, b] of usable) join(a, b);

  const groups = new Map<string, string[]>();
  for (const e of eventIds) {
    if (!nodes.has(e)) continue;
    const r = find(e);
    groups.set(r, [...(groups.get(r) ?? []), e]);
  }
  const photos = (g: string[]) => g.reduce((n, e) => n + (photosByEvent.get(e) ?? 0), 0);
  const ordered = [...groups.values()].sort(
    (x, y) => photos(y) - photos(x) || x[0].localeCompare(y[0])
  );
  ordered[0] = [...ordered[0], ...eventIds.filter((e) => !nodes.has(e))];
  return ordered;
}

/** One photographer's "same person" links, by name key. */
export async function loadSplitLinks(
  supabase: SupabaseDB,
  userId: string
): Promise<Map<string, [string, string][]>> {
  const out = new Map<string, [string, string][]>();
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("person_split_links")
      .select("name_key, event_a, event_b")
      .eq("user_id", userId)
      // Paged reads ORDER BY a unique key, always (lesson 88).
      .order("name_key")
      .order("event_a")
      .order("event_b")
      .range(page * 1000, page * 1000 + 999);
    if (error) throw error;
    for (const r of data ?? []) {
      const list = out.get(r.name_key) ?? [];
      list.push([r.event_a, r.event_b]);
      out.set(r.name_key, list);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

type Call = { groups: string[]; images: string[]; a: string[]; b: string[] };

/**
 * Split every multi-event identity whose faces disagree. With an `onError`
 * handler it fails OPEN to the old behaviour — one card per name — and
 * reports, because this is an accuracy upgrade on a working index and must
 * never be able to take /people down. Without one, it throws.
 */
export async function splitByFaces(
  supabase: SupabaseDB,
  indexed: IndexedPerson[],
  samples: ReadonlyMap<string, FaceSample[]>,
  links: SplitLinks,
  onError?: SplitErrorHandler
): Promise<IndexedPerson[]> {
  const candidates = indexed.filter((p) => p.events.length >= 2);
  if (candidates.length === 0) return indexed;

  const top = (personKey: string, eventId: string) =>
    [...(samples.get(sampleKey(personKey, eventId)) ?? [])]
      .sort((x, y) => y.score - x.score)
      .slice(0, SAMPLES_PER_EVENT);

  // Pack identities into calls by COMPARISON count. An identity whose own
  // pairs exceed a call is sent in several, each carrying its frames.
  const calls: Call[] = [];
  let cur: Call = { groups: [], images: [], a: [], b: [] };
  const flush = () => {
    if (cur.a.length) calls.push(cur);
    cur = { groups: [], images: [], a: [], b: [] };
  };
  for (const p of candidates) {
    const evs = p.events.map((e) => e.eventId);
    const groups: string[] = [];
    const images: string[] = [];
    for (const ev of evs) {
      for (const s of top(p.key, ev)) {
        groups.push(sampleKey(p.key, ev));
        images.push(s.id);
      }
    }
    const pairs: [string, string][] = [];
    for (let x = 0; x < evs.length; x++) {
      for (let y = x + 1; y < evs.length; y++) {
        pairs.push([sampleKey(p.key, evs[x]), sampleKey(p.key, evs[y])]);
      }
    }
    for (let i = 0; i < pairs.length; i += MAX_PAIRS_PER_CALL) {
      const slice = pairs.slice(i, i + MAX_PAIRS_PER_CALL);
      if (cur.a.length + slice.length > MAX_PAIRS_PER_CALL) flush();
      cur.groups.push(...groups);
      cur.images.push(...images);
      for (const [a, b] of slice) {
        cur.a.push(a);
        cur.b.push(b);
      }
    }
  }
  flush();

  const simsByPerson = new Map<string, { a: string; b: string; sim: number }[]>();
  try {
    for (const call of calls) {
      const { data, error } = await supabase.rpc("face_group_similarity", {
        p_group: call.groups,
        p_image: call.images,
        p_a: call.a,
        p_b: call.b,
      });
      if (error) throw error;
      if ((data ?? []).length >= ROW_CAP) {
        throw new Error(`face_group_similarity returned ${ROW_CAP}+ rows — truncated, not trusted`);
      }
      for (const r of data ?? []) {
        const [personKey, a] = r.a.split("|");
        const b = r.b.split("|")[1];
        const list = simsByPerson.get(personKey) ?? [];
        list.push({ a, b, sim: r.sim });
        simsByPerson.set(personKey, list);
      }
    }
  } catch (err) {
    if (!onError) throw err;
    await onError(err, { candidates: candidates.length, calls: calls.length });
    return indexed;
  }

  const bestScore = (personKey: string, eventId: string) => top(personKey, eventId)[0]?.score ?? -1;

  const out: IndexedPerson[] = [];
  for (const p of indexed) {
    const sims = simsByPerson.get(p.key);
    if (p.events.length < 2 || !sims) {
      out.push(p);
      continue;
    }
    const photos = new Map(p.events.map((e) => [e.eventId, e.imageCount]));
    const groups = groupEventsByFace(
      p.events.map((e) => e.eventId),
      photos,
      sims,
      links.get(p.key) ?? []
    );
    if (groups.length === 1) {
      out.push(p);
      continue;
    }
    groups.forEach((g, i) => {
      const members = new Set(g);
      // Filtering the original list keeps the time strip's oldest-first order.
      const events = p.events.filter((e) => members.has(e.eventId));
      const main = [...events].sort((x, y) => y.imageCount - x.imageCount)[0];
      const hero = events.reduce(
        (best, e) => (bestScore(p.key, e.eventId) > bestScore(p.key, best.eventId) ? e : best),
        events[0]
      );
      out.push({
        key: i === 0 ? p.key : splitKey(p.key, g),
        name: p.name,
        eventCount: events.length,
        imageCount: events.reduce((n, e) => n + e.imageCount, 0),
        events,
        heroKey: hero.heroKey ?? null,
        label: main.eventName,
        splitFrom: p.key,
      });
    });
  }
  return out;
}
