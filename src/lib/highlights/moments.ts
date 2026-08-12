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
  opts: { coverage?: boolean } = {}
): Moment<T>[] {
  const want = Math.max(0, Math.min(count, moments.length));
  if (!want) return [];

  const byScore = [...moments].sort((a, b) => b.score - a.score);
  if (opts.coverage === false) return byScore.slice(0, want);

  const timed = moments.filter((m) => m.at != null);
  const chosen = new Set<string>();
  const out: Moment<T>[] = [];
  const personCount = new Map<string, number>();
  // Allow a subject to recur, but not to dominate: a 40-pick reel tolerates
  // ~3 of any one person before it starts reading as a portfolio of one kid.
  const maxPerPerson = Math.max(2, Math.ceil(want / 12));

  const take = (m: Moment<T>) => {
    chosen.add(m.key);
    out.push(m);
    for (const p of m.personIds) personCount.set(p, (personCount.get(p) ?? 0) + 1);
  };
  const overExposed = (m: Moment<T>) =>
    m.personIds.length > 0 &&
    m.personIds.every((p) => (personCount.get(p) ?? 0) >= maxPerPerson);

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
        .filter((m) => !chosen.has(m.key) && !overExposed(m))
        .sort((a, b) => b.score - a.score)[0];
      if (best) take(best);
    }
  }

  // Fill remaining slots on score, still avoiding over-exposed subjects first.
  for (const pass of [true, false]) {
    for (const m of byScore) {
      if (out.length >= want) break;
      if (chosen.has(m.key)) continue;
      if (pass && overExposed(m)) continue;
      take(m);
    }
    if (out.length >= want) break;
  }

  // Deliver in rank order — the reel reads best-first, not chronologically.
  return out.sort((a, b) => b.score - a.score).slice(0, want);
}
