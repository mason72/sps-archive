/**
 * Which galleries the AI lane should be working on right now.
 *
 * The lane indexes ONE gallery at a time (lesson 168), and a run that still has
 * work re-queues itself behind every other queued run. So the set of galleries
 * allowed to run is the rotation: let 200 in and each gets a turn every 200
 * runs, which is how a new client gallery ends up waiting days behind an
 * archive import (lesson 175). Plan about as much work as the lane can do
 * before the next sweep and the priority order from `events_needing_ai_index`
 * (live galleries first, then newest shoot) is the order work happens in.
 * `plan.ts` reads the queue and applies this.
 */

/**
 * Photos to plan at once. The lane's pace is roughly 55 to 90 a minute (measured
 * 2026-10-04 on the Medium database), so about 1,600 to 2,700 per 30-minute
 * sweep; this is above that on purpose, because an idle lane with a backlog
 * costs more than a slightly wider rotation.
 */
export const AI_SWEEP_TARGET_PHOTOS = 4000;

/**
 * Never plan fewer galleries than this. A gallery whose runs keep throwing at
 * the database level stays first in line (its photos collect no attempts), and
 * if it were the only one planned the whole lane would sit behind it. Two keeps
 * the lane moving past a stuck gallery while still giving the first in line
 * half the lane; a larger floor is a wider rotation and a slower first gallery.
 */
export const AI_SWEEP_MIN_EVENTS = 2;

/** Candidates to ask the database for. The SQL clamps at 50 whatever is passed. */
export const AI_SWEEP_CANDIDATES = 25;

export interface SweepCandidate {
  event_id: string;
  pending: number;
}

/**
 * Take candidates in the order given until they hold `targetPhotos` waiting
 * photos, but never fewer than `minEvents` of them.
 */
export function planSweep(
  candidates: SweepCandidate[],
  targetPhotos: number = AI_SWEEP_TARGET_PHOTOS,
  minEvents: number = AI_SWEEP_MIN_EVENTS
): string[] {
  const picked: string[] = [];
  let photos = 0;
  for (const c of candidates) {
    if (picked.length >= minEvents && photos >= targetPhotos) break;
    picked.push(c.event_id);
    photos += Number(c.pending) || 0;
  }
  return picked;
}
