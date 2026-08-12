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
 * A tile's rendered height per unit column width — the number `distributeBalanced`
 * balances on. It must describe what the tile ACTUALLY RENDERS AS, not what its
 * source image is.
 *
 * That distinction was the bug behind the editor's ragged columns. A collapsed
 * stack renders its cover inside a FIXED `aspect-[3/4]` box (CollapsedStack in
 * SmartStack.tsx), but the packer was handed the cover photo's NATURAL aspect,
 * so every stack tile was mis-sized by however far that photo differed from 3:4.
 * Measured across the live archive the mean error runs 18%–79% per gallery, and
 * — this is the part that shows — it varies tile to tile with the
 * portrait/landscape mix, so the errors never cancel. Columns accumulate
 * invisible height, overshoot, keep being fed, and end at very different points.
 *
 * Two things this is NOT:
 * - **Not the filename strip.** That renders `absolute bottom-0` INSIDE the
 *   tile and adds zero height. An earlier diagnosis blamed it and proposed a
 *   per-item caption constant; that would have stacked a second, opposite error
 *   on top of this one.
 * - **Not for the PUBLIC grid.** `GalleryGrid` renders a stack tile at its
 *   cover's natural aspect, so its own inline estimate is already correct and
 *   routing it through here would BREAK it. The two grids genuinely render
 *   stacks differently; this function describes the editor's tile only.
 */
export const STACK_TILE_HEIGHT_UNIT = 4 / 3; // CollapsedStack's aspect-[3/4]
export const UNKNOWN_DIMS_HEIGHT_UNIT = 4 / 3; // GridImage's "3 / 4" fallback

export function tileHeightUnit(
  item:
    | { type: "stack" }
    | { type: "image"; data: { width?: number | null; height?: number | null } },
  uniform: boolean
): number {
  // Uniform style renders every tile 1:1, stacks included.
  if (uniform) return 1;
  if (item.type === "stack") return STACK_TILE_HEIGHT_UNIT;
  const d = item.data;
  return d && d.width && d.height ? d.height / d.width : UNKNOWN_DIMS_HEIGHT_UNIT;
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
