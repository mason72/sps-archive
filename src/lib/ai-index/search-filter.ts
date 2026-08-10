/**
 * Semantic-match shaping shared by the admin and guest search routes.
 *
 * Why not a fixed threshold: measured live 2026-08-10, real-but-subtle
 * queries ("the first dance" on a wedding) top out ~0.058 while archive-wide
 * nonsense ("purple elephant in space") reaches 0.052 — the ranges overlap,
 * so any constant either hides real matches or admits junk. Instead:
 *
 *  - RELATIVE cut: keep matches within SEMANTIC_RELATIVE_KEEP of the top
 *    score. A strong query keeps its ranked slice; a weak one collapses to a
 *    couple of best-efforts instead of 50 rows of noise.
 *  - ABSOLUTE floor: below SEMANTIC_FLOOR nothing is a match at all
 *    (nonsense queries mostly top out under it).
 *
 * Callers pass the RPC a low threshold (SEMANTIC_RPC_THRESHOLD) and shape
 * the result here — the DB does recall, this does precision.
 */
export const SEMANTIC_RPC_THRESHOLD = 0.02;
export const SEMANTIC_FLOOR = 0.04;
export const SEMANTIC_RELATIVE_KEEP = 0.6;

export function filterSemanticMatches<T extends { similarity: number }>(
  matches: T[]
): T[] {
  if (!matches.length) return matches;
  const top = matches[0].similarity;
  const cut = Math.max(SEMANTIC_FLOOR, top * SEMANTIC_RELATIVE_KEEP);
  return matches.filter((m) => m.similarity >= cut);
}
