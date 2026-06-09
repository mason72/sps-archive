import { useState, useEffect } from "react";

/**
 * Shared masonry-grid layout primitives, used by BOTH the editor grid
 * (ImageGrid) and the public grid (GalleryGrid) so reading order and the
 * responsive column count are defined ONCE. Previously each grid had its own
 * copy, which drifted (the editor read top-to-bottom while the public read
 * left-to-right — a real bug). Keep this the single source of truth.
 */

/* ─── Responsive column count (mirrors the Tailwind breakpoints) ─── */
// [default, sm≥640, lg≥1024, xl≥1280]
const RESPONSIVE_COLS: Record<number, number[]> = {
  2: [1, 2, 2, 2],
  3: [1, 2, 3, 3],
  4: [1, 2, 3, 4],
  5: [2, 3, 4, 5],
  6: [2, 3, 4, 6],
  7: [2, 3, 5, 7],
};

function colsForWidth(tiers: number[], w: number): number {
  if (w >= 1280) return tiers[3];
  if (w >= 1024) return tiers[2];
  if (w >= 640) return tiers[1];
  return tiers[0];
}

/** Responsive column count for a target column setting (1–7). */
export function useResponsiveColumns(target: number): number {
  const tiers = RESPONSIVE_COLS[target] ?? RESPONSIVE_COLS[4];
  const [cols, setCols] = useState(() =>
    typeof window === "undefined" ? tiers[0] : colsForWidth(tiers, window.innerWidth)
  );
  useEffect(() => {
    const update = () => setCols(colsForWidth(tiers, window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [tiers]);
  return cols;
}

/**
 * Distribute items round-robin into N columns (item i → column i % n), which
 * preserves LEFT-TO-RIGHT reading order: the sorted sequence reads across the
 * first row, then wraps. (CSS multi-column fills top-to-bottom down each column
 * first, which broke sorted reading order — do not use that here.)
 */
export function distributeIntoColumns<T>(items: T[], numCols: number): T[][] {
  const columns: T[][] = Array.from({ length: Math.max(1, numCols) }, () => []);
  items.forEach((item, i) => {
    columns[i % columns.length].push(item);
  });
  return columns;
}

/**
 * Distribute items into N columns using shortest-column-first packing, so column
 * HEIGHTS stay balanced. Round-robin above balances item COUNTS but not heights,
 * which leaves one column far taller when tall (portrait) tiles cluster —
 * especially in small sets (few rows to average over). That's the "one column
 * way too tall" look in the editor's smaller sections.
 *
 * `getHeightUnit(item)` returns an item's rendered height per unit column width
 * (i.e. height / width — the inverse of the CSS aspect-ratio). Each item lands
 * in the currently-shortest column; ties go to the leftmost, so the first row
 * still reads left-to-right before balancing kicks in. Deterministic (no
 * randomness) so server and client produce the same layout.
 */
export function distributeBalanced<T>(
  items: T[],
  numCols: number,
  getHeightUnit: (item: T) => number
): T[][] {
  const n = Math.max(1, numCols);
  const columns: T[][] = Array.from({ length: n }, () => []);
  const heights = new Array<number>(n).fill(0);
  for (const item of items) {
    let min = 0;
    for (let c = 1; c < n; c++) {
      if (heights[c] < heights[min] - 1e-9) min = c;
    }
    columns[min].push(item);
    heights[min] += Math.max(0.01, getHeightUnit(item) || 1);
  }
  return columns;
}
