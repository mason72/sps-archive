/**
 * What "the same face" means in this archive — one home, because the naming
 * engine's suggestions and the /people split must never disagree about it.
 *
 * Measured 2026-08-16 against ground truth (identities holding 2+ named
 * clusters, hold-one-out over 80 matches):
 *   best WRONG-identity match:  p50 0.226, p90 0.291, MAX 0.363
 *   true same-identity match:   p50 0.886, p90 0.998
 * Re-confirmed 2026-09-11 on 709 cross-event pairs under shared names: 632 at
 * or above the floor, 77 below the ceiling, none in between.
 */

/** At or above this cosine similarity, two faces are treated as one person. */
export const FACE_MATCH_FLOOR = 0.55;

/** The highest similarity ever measured between two DIFFERENT people. */
export const IMPOSTOR_MAX = 0.363;
