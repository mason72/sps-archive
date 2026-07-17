import { buildStacks } from "@/lib/gallery/stacks";

/**
 * Mosaic cover engine — pure math, no DOM, no network.
 *
 * Runs in two places that must agree exactly:
 *  - the live gallery (CSS grid tiles from the payload's images), and
 *  - the raster composer (sharp composite for email/OG).
 * Keep it deterministic: same inputs → same tiles in the same order.
 */

/** Tile aspect ratio (w/h). Portrait 3:4 — photo-booth shots crop well to it. */
export const MOSAIC_TILE_AR = 0.75;

/** Logo height as a fraction of the insert hole's height (renderers center it). */
export const MOSAIC_INSERT_LOGO_H = 0.6;

/** Mulberry32 — tiny deterministic PRNG so a seed fully fixes the shuffle. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = items.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Pick mosaic tile images from a section's images (in section order).
 *
 * Dedupes by person stack first — photo-booth sections are runs of
 * near-identical shots, and a wall of repeated faces reads as a bug. Each
 * stack contributes its lead image only; the seeded shuffle then fixes the
 * arrangement until the photographer hits Shuffle.
 */
export function selectMosaicTiles<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[], seed: number, count: number): T[] {
  return orderTiles(dedupeStackLeads(images), seed).slice(0, count);
}

/** One lead image per person stack — the mosaic's candidate pool. */
export function dedupeStackLeads<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[]): T[] {
  return buildStacks(images).map((s) => s.images[0]);
}

/** Seed-fixed arrangement of an already-deduped pool. */
export function orderTiles<T>(leads: T[], seed: number): T[] {
  return seededShuffle(leads, seed);
}

/**
 * Crossfade hero images: stack-deduped, in section order (no shuffle — the
 * section's order is the photographer's curation).
 */
export function selectCrossfadeImages<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[], count: number): T[] {
  return buildStacks(images)
    .map((s) => s.images[0])
    .slice(0, count);
}

export interface MosaicGrid {
  rows: number;
  cols: number;
  tileW: number;
  tileH: number;
  /** rows × cols — tiles needed before any insert hole is subtracted. */
  cells: number;
}

/**
 * Grid dimensions for a mosaic band. Columns derive from the container so
 * tiles hold ~3:4 at every viewport; rows drop when the (deduped) pool can't
 * fill the requested density — never repeat a tile to pad the wall.
 */
export function computeMosaicGrid(opts: {
  containerW: number;
  bandH: number;
  rows: number;
  poolSize: number;
}): MosaicGrid {
  const { containerW, bandH, poolSize } = opts;
  let rows = Math.max(1, Math.round(opts.rows));
  const idealTileH = bandH / rows;
  const ideal = Math.max(2, Math.round(containerW / (idealTileH * MOSAIC_TILE_AR)));
  let cols = ideal;

  // Not enough distinct images: squeeze columns slightly (tiles get up to
  // ~25% wider than ideal) before giving up a whole row — a 32-image pool
  // should still fill the 3 rows it asked for, not drop to 2.
  const minCols = Math.max(2, Math.ceil(ideal * 0.8));
  while (rows > 1 && rows * cols > poolSize) {
    if (cols > minCols) cols--;
    else {
      rows--;
      cols = ideal;
    }
  }
  if (rows === 1 && cols > poolSize) cols = Math.max(1, poolSize);

  return {
    rows,
    cols,
    tileW: containerW / cols,
    tileH: bandH / rows,
    cells: rows * cols,
  };
}

export interface MosaicHole {
  /** 0-based cell coords, spans in whole cells. */
  startRow: number;
  rowSpan: number;
  startCol: number;
  colSpan: number;
  /**
   * Logo render height as a fraction of the hole's height. Usually
   * MOSAIC_INSERT_LOGO_H; smaller when the hole is full-band-height (2-row
   * grids), where 60% of the band would balloon a wide logo into a hole
   * that swallows the mosaic.
   */
  logoHeightFrac: number;
}

/**
 * Insert-mode hole: a centered block of whole cells that holds the logo
 * (the Uber-cover look — whitespace edges align with tile edges).
 *
 * Row rule: leave one full row of tiles above and below (4→2, 3→1); a
 * 2-row grid can't center a 1-row hole, so it goes full-height instead —
 * two photo walls flanking a logo column.
 */
export function computeInsertHole(opts: {
  grid: MosaicGrid;
  /** Logo w/h; pre-measure from the asset. Wide-lockup default. */
  logoAspect?: number;
  /** Whitespace around the logo inside the hole, % of hole height (0–45). */
  paddingPct: number;
}): MosaicHole | null {
  const { grid, paddingPct } = opts;
  const logoAspect = opts.logoAspect && opts.logoAspect > 0 ? opts.logoAspect : 2.5;
  const { rows, cols, tileW, tileH } = grid;
  if (rows * cols < 6) return null; // too small to lose cells to a hole

  const rowSpan = rows === 2 ? 2 : Math.max(1, rows - 2);
  const holeH = rowSpan * tileH;
  const pad = Math.min(45, Math.max(0, paddingPct)) / 100;
  // The logo renders at a fixed fraction of the hole height (the hole is
  // row-snapped, so vertical whitespace is set by that snap); the padding
  // slider adds HORIZONTAL breathing room only — more padding, wider hole.
  // Shrinking the logo with padding instead would make wide logos produce
  // NARROWER holes as padding grows (width loss beats the added padding).
  // Full-height holes (2-row grids) drop the logo fraction: 60% of the
  // whole band × a wide logo would swallow nearly every column.
  const logoHeightFrac = rowSpan === rows ? 0.35 : MOSAIC_INSERT_LOGO_H;
  const logoH = holeH * logoHeightFrac;
  const logoW = logoH * logoAspect;
  // Padding is relative to the logo itself, not the hole — "space around
  // the logo" should read the same at every density.
  let colSpan = Math.ceil((logoW + logoH * 2 * pad) / tileW);
  // Center-snap: hole and grid column counts must share parity.
  if ((cols - colSpan) % 2 !== 0) colSpan += 1;
  colSpan = Math.min(colSpan, cols - 2);
  if (colSpan < 1) return null;
  // Parity clamp may have broken it again at the boundary; re-align down.
  if ((cols - colSpan) % 2 !== 0) colSpan = Math.max(1, colSpan - 1);

  return {
    startRow: Math.floor((rows - rowSpan) / 2),
    rowSpan,
    startCol: (cols - colSpan) / 2,
    colSpan,
    logoHeightFrac,
  };
}

/** Cells a hole covers — subtract from `grid.cells` to get tiles needed. */
export function holeCells(hole: MosaicHole | null): number {
  return hole ? hole.rowSpan * hole.colSpan : 0;
}

/** True if the cell (r, c) lies inside the hole. */
export function cellInHole(hole: MosaicHole | null, r: number, c: number): boolean {
  if (!hole) return false;
  return (
    r >= hole.startRow &&
    r < hole.startRow + hole.rowSpan &&
    c >= hole.startCol &&
    c < hole.startCol + hole.colSpan
  );
}
