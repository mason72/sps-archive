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
  /**
   * Who this frame is OF, for coverage balancing: face-cluster person ids,
   * and (from propose) a `name:` key for the person the filename names, which
   * is what catches a subject no face cluster holds (a robot dog's stack).
   */
  personIds?: string[];
  /** Capped kinds this frame counts toward (rules.ts: "glasses", "group"). */
  tags?: string[];
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
  /** Union of cap tags across the moment's frames. */
  tags: string[];
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
    const tags = new Set<string>();
    for (const f of frames) for (const t of f.tags ?? []) tags.add(t);
    const at = frames[0].takenAt ? new Date(frames[0].takenAt).getTime() : null;
    moments.push({
      key,
      frames,
      bestIndex,
      score: frames[bestIndex].score,
      at: at != null && Number.isFinite(at) ? at : null,
      personIds: [...persons],
      tags: [...tags],
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
 * Three HARD limits (2026-11-16, Mason and Justin on Electronica) are never
 * relaxed to fill a slot, so a set can come back short rather than break them:
 *   - `onePerPerson`: a portrait or pair is out once ANY of its subjects
 *     already has a portrait or pair in the set ("limit highlights to one of
 *     the same person"); a moment tagged "group" is out once MOST of its subject
 *     faces are in the set at all. A group shot does NOT use its people up for
 *     their own portrait (Mason, 2026-11-16: strict counting left a 100-guest
 *     party of big group shots at 12-16 of 40), so a guest can appear once in
 *     a group and once on their own, never in two portraits.
 *     WHO a subject is: with `facesOf` + `samePerson`, a face matching a
 *     chosen face at the archive's same-person floor (calibration.ts), so a
 *     guest whose faces never clustered is still recognised (two thirds of
 *     Team Curry's faces had no cluster); a moment whose faces are unknown is
 *     never picked unverified. A `name:` key (the filename's person) blocks too,
 *     which catches a covered face. Without `facesOf`, cluster ids decide.
 *   - `caps`: at most N moments carrying a tag (rules.ts: glasses, group).
 * People and tags are the CHOSEN frame's, not the moment's union: two booths
 * firing in the same second are one moment, and picking one must not mark the
 * other booth's guests as used.
 * And one pull: `variety` lowers a candidate by how closely its largest face
 * resembles a face already chosen, so the set spreads across how people look
 * without anyone being labelled by gender or race (Mason's choice, the same
 * day). Scores enter that trade as percentiles, so the units agree; tied
 * scores share a percentile, so an unranked event (every score 0) is not
 * ordered by capture time by accident. A moment whose face is unknown takes the
 * average resemblance of the ones that are known, never a free pass.
 *
 * With `coverage: false` and no hard limits this is exactly top-N by score.
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
    /** Hard: no subject appears twice. */
    onePerPerson?: boolean;
    /** Hard: at most this many moments per tag. */
    caps?: Record<string, number>;
    /** Unit face vectors of the chosen frame's SUBJECT faces, largest first. */
    facesOf?: (m: Moment<T>) => number[][] | undefined;
    /** Cosine at or above which two faces are one person (FACE_MATCH_FLOOR). */
    samePerson?: number;
    /** How hard resemblance to an already-chosen face pulls a candidate down. */
    variety?: number;
  } = {}
): Moment<T>[] {
  const want = Math.max(0, Math.min(count, moments.length));
  if (!want) return [];

  const byScore = [...moments].sort((a, b) => b.score - a.score);
  if (opts.coverage === false && !opts.onePerPerson && !opts.caps) {
    return byScore.slice(0, want);
  }

  const peopleOf = (m: Moment<T>) => m.frames[m.bestIndex].personIds ?? [];
  const tagsOf = (m: Moment<T>) => m.frames[m.bestIndex].tags ?? [];

  const timed = moments.filter((m) => m.at != null);
  const chosen = new Set<string>();
  const out: Moment<T>[] = [];
  const personCount = new Map<string, number>(); // every pick
  const soloCount = new Map<string, number>(); // portrait and pair picks only
  const tagCount = new Map<string, number>();
  /**
   * How often one subject may recur, scaled to how many subjects EXIST.
   * A fixed `count/12` allowed four appearances each — fine for a wedding with
   * a dozen key people, absurd for an activation where 87 people passed the
   * booth and only 40 slots exist. With more people than slots nobody needs to
   * appear twice; with few people the cap opens up automatically.
   */
  const distinctPersons = new Set(moments.flatMap((m) => peopleOf(m))).size;
  const maxPerPerson = opts.onePerPerson
    ? 1
    : Math.max(2, Math.ceil(want / Math.max(1, distinctPersons)) + 1);
  const crewIds = opts.crewIds ?? new Set<string>();
  const crewCap = Math.max(1, Math.round(want * (opts.maxCrewFraction ?? 0.15)));
  let crewTaken = 0;

  // Faces: per moment, each subject face's best match to any CHOSEN face.
  // Updated incrementally on every take, so a check is a lookup.
  const faces = new Map<string, number[][]>();
  if (opts.facesOf) {
    for (const m of moments) {
      const v = opts.facesOf(m);
      if (v?.length) faces.set(m.key, v);
    }
  }
  const faceMax = new Map<string, number[]>(); // vs every chosen face
  const faceMaxSolo = new Map<string, number[]>(); // vs portrait and pair picks' faces
  for (const [k, vs] of faces) {
    faceMax.set(k, vs.map(() => -1));
    faceMaxSolo.set(k, vs.map(() => -1));
  }
  const isGroup = (m: Moment<T>) => tagsOf(m).includes("group");

  // Variety: percentile score minus resemblance of the largest face.
  const variety = opts.facesOf ? (opts.variety ?? 0) : 0;
  const pct = new Map<string, number>();
  for (let i = 0; i < byScore.length; ) {
    let j = i;
    while (j + 1 < byScore.length && byScore[j + 1].score === byScore[i].score) j++;
    const mid = (i + j) / 2; // tied scores share the average rank
    for (let k = i; k <= j; k++) {
      pct.set(byScore[k].key, byScore.length > 1 ? 1 - mid / (byScore.length - 1) : 1);
    }
    i = j + 1;
  }
  let meanNearest = 0; // over unchosen moments with a known face
  const value = (m: Moment<T>) => {
    if (!variety) return m.score;
    const fm = faceMax.get(m.key);
    const near = fm ? Math.max(0, fm[0]) : meanNearest;
    return pct.get(m.key)! - variety * near;
  };

  const isCrewMoment = (m: Moment<T>) => peopleOf(m).some((p) => crewIds.has(p));

  const take = (m: Moment<T>) => {
    chosen.add(m.key);
    out.push(m);
    if (isCrewMoment(m)) crewTaken++;
    const solo = !isGroup(m);
    for (const p of peopleOf(m)) {
      personCount.set(p, (personCount.get(p) ?? 0) + 1);
      if (solo) soloCount.set(p, (soloCount.get(p) ?? 0) + 1);
    }
    for (const t of tagsOf(m)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    const added = faces.get(m.key);
    if (!added) return;
    let sum = 0;
    let n = 0;
    for (const [k, vs] of faces) {
      if (chosen.has(k)) continue;
      const fm = faceMax.get(k)!;
      const fs = faceMaxSolo.get(k)!;
      for (let a = 0; a < vs.length; a++) {
        for (const nv of added) {
          let dot = 0;
          for (let i = 0; i < nv.length; i++) dot += nv[i] * vs[a][i];
          if (dot > fm[a]) fm[a] = dot;
          if (solo && dot > fs[a]) fs[a] = dot;
        }
      }
      sum += Math.max(0, fm[0]);
      n++;
    }
    meanNearest = n ? sum / n : 0;
  };

  /**
   * A moment is over-exposed when MOST of its subjects have already been seen
   * enough. `every` was the original test and it never fired: a group shot
   * almost always contains one fresh face, so a five-person crew photo sailed
   * through however many times those five had already appeared. That is what
   * produced repeated near-identical staff pairs in the first live run.
   */
  const overExposed = (m: Moment<T>) => {
    const people = peopleOf(m);
    if (!people.length) return false;
    const seen = people.filter((p) => (personCount.get(p) ?? 0) >= maxPerPerson).length;
    return seen * 2 > people.length;
  };

  /** Limits no pass relaxes. */
  const hardBlocked = (m: Moment<T>) => {
    if (opts.onePerPerson) {
      const people = peopleOf(m);
      const group = isGroup(m);
      // A portrait or pair is judged against portrait and pair picks only (a
      // group shot does not use its people up); a group against every pick.
      const counts = group ? personCount : soloCount;
      if (!group && people.some((p) => p.startsWith("name:") && (counts.get(p) ?? 0) >= 1)) return true;
      // Clusters and face matches are each evidence; use BOTH. A cluster joins
      // faces through a running average, so two faces of one person can sit in
      // one cluster yet match each other below the floor (11% of same-cluster
      // pairs at Team Curry); a face match sees guests no cluster holds.
      const ids = people.filter((p) => !p.startsWith("name:"));
      const idsSeen = ids.filter((p) => (counts.get(p) ?? 0) >= 1).length;
      if (opts.samePerson != null) {
        const fm = (group ? faceMax : faceMaxSolo).get(m.key);
        if (!fm) return true; // who this is cannot be checked: never pick it unverified
        const matched = fm.filter((x) => x >= opts.samePerson!).length;
        if (
          group
            ? Math.max(matched, idsSeen) * 2 > Math.max(fm.length, ids.length)
            : matched > 0 || idsSeen > 0
        ) {
          return true;
        }
      } else if (group ? idsSeen * 2 > ids.length : idsSeen > 0) {
        return true;
      }
    }
    if (opts.caps) {
      for (const t of tagsOf(m)) {
        const cap = opts.caps[t];
        if (cap != null && (tagCount.get(t) ?? 0) >= cap) return true;
      }
    }
    return false;
  };

  /** Skip while the crew budget is spent; the final fallback ignores this. */
  const crewBlocked = (m: Moment<T>) => isCrewMoment(m) && crewTaken >= crewCap;

  /** Highest-value eligible moment; ties keep score order. */
  const best = (pool: Moment<T>[], soft: boolean) => {
    let top: Moment<T> | undefined;
    let topValue = -Infinity;
    for (const m of pool) {
      if (chosen.has(m.key) || hardBlocked(m)) continue;
      if (soft && (overExposed(m) || crewBlocked(m))) continue;
      const v = value(m);
      if (v > topValue) {
        top = m;
        topValue = v;
      }
    }
    return top;
  };

  if (opts.coverage !== false && timed.length >= want) {
    // Min and max, never first and last: callers may pass moments in score
    // order (propose passes its shortlist), and a negative bucket crashed it.
    let first = Infinity;
    let last = -Infinity;
    for (const m of timed) {
      if (m.at! < first) first = m.at!;
      if (m.at! > last) last = m.at!;
    }
    const span = Math.max(1, last - first);
    const buckets: Moment<T>[][] = Array.from({ length: want }, () => []);
    for (const m of timed) {
      const b = Math.min(want - 1, Math.floor(((m.at! - first) / span) * want));
      buckets[b].push(m);
    }
    for (const bucket of buckets) {
      bucket.sort((a, b) => b.score - a.score);
      const pick = best(bucket, true);
      if (pick) take(pick);
    }
  }

  // Fill remaining slots on value, still avoiding over-exposed subjects first.
  for (const soft of [true, false]) {
    while (out.length < want) {
      const pick = best(byScore, soft);
      if (!pick) break;
      take(pick);
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
