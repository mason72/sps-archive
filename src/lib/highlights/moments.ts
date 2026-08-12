/**
 * Moments — the unit the whole feature counts in.
 *
 * A moment is one capture. It can be several FILES: a burst renders as
 * several frames, and a branded activation renders the same capture once per
 * overlay treatment. The Jordan x Kids Foot Locker event is 679 files but only
 * 358 moments, because every vertical ships as both "All Star" and "She's Got
 * Game". A reel built on files shows each of those twice.
 *
 * Grouping is by EXACT capture time, deliberately not by embedding similarity.
 * Measured on that event, consecutive-pair SigLIP cosine has a median of 0.915
 * while the *known* duplicate renditions sit at 0.918 — statistically
 * indistinguishable, because on a fixed backdrop the embedding encodes the set,
 * not the subject. Capture time separates them exactly.
 *
 * Images with no `taken_at` each become their own moment: a false split is
 * visible in the review and recoverable in one click, a false merge silently
 * deletes a candidate the photographer can never choose.
 */

export interface MomentInput {
  id: string;
  takenAt: string | null;
  /** Higher is better; drives which frame represents the moment. */
  score: number;
  /** Person ids visible in this frame, for coverage balancing. */
  personIds?: string[];
}

export interface Moment<T extends MomentInput = MomentInput> {
  /** Stable key: the shared capture time, else the single image id. */
  key: string;
  frames: T[];
  /** Index into `frames` of the best-scoring frame. */
  bestIndex: number;
  /** The moment's score — its best frame's. */
  score: number;
  /** Epoch ms of the capture, null when unknown. */
  at: number | null;
  /** Union of persons across the moment's frames. */
  personIds: string[];
}

export function groupIntoMoments<T extends MomentInput>(images: T[]): Moment<T>[] {
  const byKey = new Map<string, T[]>();
  for (const img of images) {
    const key = img.takenAt ? `t:${img.takenAt}` : `i:${img.id}`;
    const arr = byKey.get(key);
    if (arr) arr.push(img);
    else byKey.set(key, [img]);
  }

  const moments: Moment<T>[] = [];
  for (const [key, frames] of byKey) {
    let bestIndex = 0;
    for (let i = 1; i < frames.length; i++) {
      if (frames[i].score > frames[bestIndex].score) bestIndex = i;
    }
    const persons = new Set<string>();
    for (const f of frames) for (const p of f.personIds ?? []) persons.add(p);
    const at = frames[0].takenAt ? new Date(frames[0].takenAt).getTime() : null;
    moments.push({
      key,
      frames,
      bestIndex,
      score: frames[bestIndex].score,
      at: at != null && Number.isFinite(at) ? at : null,
      personIds: [...persons],
    });
  }

  moments.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return moments;
}

/**
 * Choose `count` moments, balancing quality against coverage.
 *
 * Pure top-N by score clusters: at a photobooth the winners pile onto whichever
 * few subjects photographed best, and forty gorgeous frames of the same three
 * kids is a bad reel however good each frame is. So the timeline is split into
 * `count` buckets and each contributes its best moment first; whatever is left
 * fills on score. A person seen `maxPerPerson` times is skipped in the first
 * pass, which spreads subjects without ever leaving slots unfilled.
 *
 * With `coverage: false` this is exactly top-N by score.
 */
export function selectMoments<T extends MomentInput>(
  moments: Moment<T>[],
  count: number,
  opts: {
    coverage?: boolean;
    /**
     * People who work the event rather than attend it — see `findCrew`. A
     * guest gallery is about the guests, so crew are capped rather than
     * banned: a couple of team shots belong, twenty-nine do not.
     */
    crewIds?: Set<string>;
    /** Share of the set crew may occupy. */
    maxCrewFraction?: number;
  } = {}
): Moment<T>[] {
  const want = Math.max(0, Math.min(count, moments.length));
  if (!want) return [];

  const byScore = [...moments].sort((a, b) => b.score - a.score);
  if (opts.coverage === false) return byScore.slice(0, want);

  const timed = moments.filter((m) => m.at != null);
  const chosen = new Set<string>();
  const out: Moment<T>[] = [];
  const personCount = new Map<string, number>();
  /**
   * How often one subject may recur, scaled to how many subjects EXIST.
   * A fixed `count/12` allowed four appearances each — fine for a wedding with
   * a dozen key people, absurd for an activation where 87 people passed the
   * booth and only 40 slots exist. With more people than slots nobody needs to
   * appear twice; with few people the cap opens up automatically.
   */
  const distinctPersons = new Set(moments.flatMap((m) => m.personIds)).size;
  const maxPerPerson = Math.max(
    2,
    Math.ceil(want / Math.max(1, distinctPersons)) + 1
  );
  const crewIds = opts.crewIds ?? new Set<string>();
  const crewCap = Math.max(1, Math.round(want * (opts.maxCrewFraction ?? 0.15)));
  let crewTaken = 0;

  const isCrewMoment = (m: Moment<T>) =>
    m.personIds.length > 0 && m.personIds.some((p) => crewIds.has(p));

  const take = (m: Moment<T>) => {
    chosen.add(m.key);
    out.push(m);
    if (isCrewMoment(m)) crewTaken++;
    for (const p of m.personIds) personCount.set(p, (personCount.get(p) ?? 0) + 1);
  };

  /**
   * A moment is over-exposed when MOST of its subjects have already been seen
   * enough. `every` was the original test and it never fired: a group shot
   * almost always contains one fresh face, so a five-person crew photo sailed
   * through however many times those five had already appeared. That is what
   * produced repeated near-identical staff pairs in the first live run.
   */
  const overExposed = (m: Moment<T>) => {
    if (!m.personIds.length) return false;
    const seen = m.personIds.filter(
      (p) => (personCount.get(p) ?? 0) >= maxPerPerson
    ).length;
    return seen * 2 > m.personIds.length;
  };

  /** Skip while the crew budget is spent; the final fallback ignores this. */
  const crewBlocked = (m: Moment<T>) => isCrewMoment(m) && crewTaken >= crewCap;

  if (timed.length >= want) {
    const first = timed[0].at!;
    const last = timed[timed.length - 1].at!;
    const span = Math.max(1, last - first);
    const buckets: Moment<T>[][] = Array.from({ length: want }, () => []);
    for (const m of timed) {
      const b = Math.min(want - 1, Math.floor(((m.at! - first) / span) * want));
      buckets[b].push(m);
    }
    for (const bucket of buckets) {
      const best = bucket
        .filter(
          (m) => !chosen.has(m.key) && !overExposed(m) && !crewBlocked(m)
        )
        .sort((a, b) => b.score - a.score)[0];
      if (best) take(best);
    }
  }

  // Fill remaining slots on score, still avoiding over-exposed subjects first.
  for (const pass of [true, false]) {
    for (const m of byScore) {
      if (out.length >= want) break;
      if (chosen.has(m.key)) continue;
      if (pass && (overExposed(m) || crewBlocked(m))) continue;
      take(m);
    }
    if (out.length >= want) break;
  }

  // Deliver in rank order — the reel reads best-first, not chronologically.
  return out.sort((a, b) => b.score - a.score).slice(0, want);
}

/**
 * Who is working the event rather than attending it.
 *
 * A guest visits the booth once: their faces cluster into a few minutes. Crew
 * are present all day, so their appearances span a large share of the shoot.
 * On the Foot Locker activation this separates 16 staff from 71 guests.
 *
 * Deliberately a SHAPE test, not a look test — it needs no model and no
 * training data. It is scoped to events with many short-lived subjects: a
 * wedding's couple also spans the whole day, which is why callers pass a
 * `minPersons` floor and why crew are capped rather than excluded.
 */
export function findCrew(
  appearances: Map<string, number[]>,
  eventSpanMs: number,
  opts: { spanFraction?: number; minMoments?: number; minPersons?: number } = {}
): Set<string> {
  const crew = new Set<string>();
  if (eventSpanMs <= 0) return crew;
  if (appearances.size < (opts.minPersons ?? 12)) return crew;
  const spanFraction = opts.spanFraction ?? 0.25;
  const minMoments = opts.minMoments ?? 4;
  for (const [person, times] of appearances) {
    if (times.length < minMoments) continue;
    const span = Math.max(...times) - Math.min(...times);
    if (span / eventSpanMs > spanFraction) crew.add(person);
  }
  return crew;
}
