import { buildStacks } from "@/lib/gallery/stacks";
import { detectStackable } from "@/lib/gallery/stackable";

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
 * Dedupes by person stack first WHEN THE SET STACKS — a headshot day is runs
 * of near-identical shots, and a wall of repeated faces reads as a bug. Each
 * stack contributes its lead image only; the seeded shuffle then fixes the
 * arrangement until the photographer hits Shuffle.
 */
export function selectMosaicTiles<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[], seed: number, count: number): T[] {
  return orderTiles(dedupeStackLeads(images), seed).slice(0, count);
}

/**
 * The mosaic's candidate pool: one lead image per person stack when the set
 * is stackable, every image otherwise.
 *
 * It used to dedupe unconditionally, and buildStacks groups by whatever the
 * filename parses to — so any set whose files share one label collapsed to
 * ONE tile: every camera-named event ("IMG_0001" … all key to "img"), and
 * every export named after the job (Core SJC's 287 files all parse to
 * "Google Booth"; across the archive, dozens of events sit at 80%+ under one
 * bogus name — "2Dudes WF", "MBA", "Bay, Alarm"). Mason chose Mosaic, got a
 * single photo beside the logo, and no control on the panel could change
 * it (2026-09-02). The grids already ask `detectStackable` before they
 * stack; the cover now asks the same question, so the two can never disagree
 * about whether a set has people in it.
 */
export function dedupeStackLeads<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[]): T[] {
  if (!detectStackable(images).stackable) return images;
  return buildStacks(images).map((s) => s.images[0]);
}

/** Seed-fixed arrangement of an already-deduped pool. */
export function orderTiles<T>(leads: T[], seed: number): T[] {
  return seededShuffle(leads, seed);
}

/**
 * Crossfade hero images: stack-deduped when the set stacks, in section order
 * (no shuffle — the section's order is the photographer's curation).
 */
export function selectCrossfadeImages<
  T extends { parsedName: string | null; originalFilename: string }
>(images: T[], count: number): T[] {
  return dedupeStackLeads(images).slice(0, count);
}

/**
 * Bump when layout output changes shape for the same settings — it feeds the
 * raster inputs hash, so deployed layout changes lazily regenerate stored
 * rasters instead of serving stale arrangements forever.
 */
export const MOSAIC_LAYOUT_VERSION = 2;

export interface MosaicTileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MosaicHoleRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Logo render height in px (centered in the hole; width from its aspect). */
  logoH: number;
}

export interface MosaicLayout {
  rows: number;
  rowH: number;
  /** Positioned tiles, index-aligned with the consumed prefix of `aspects`. */
  tiles: MosaicTileRect[];
  hole: MosaicHoleRect | null;
}

/**
 * Justified-rows mosaic (the Uber/FB photo-wall look): every row shares one
 * height, but each photo keeps its natural aspect ratio, so internal edges
 * stagger and nothing gets the hard uniform-cell crop. Each row (or row
 * segment beside the hole) is justified: nominal widths `ar × rowH` are
 * scaled to fill the segment exactly, and object-cover absorbs the small
 * residual (a few %, versus the old forced 3:4).
 *
 * Insert hole: a free-width rectangle — hard-edged, vertically snapped to
 * whole rows, horizontally sized in PIXELS from the logo + padding. No
 * column quantization: the padding slider moves the edge continuously.
 * Row rule: one full row of tiles above and below (4→2, 3→1); a 2-row band
 * gets a full-height hole — two photo walls flanking a logo panel.
 */
export function layoutMosaic(opts: {
  containerW: number;
  bandH: number;
  /** Requested rows; shed when the pool can't fill them (never repeat). */
  rows: number;
  /** Pool aspect ratios (w/h) in arrangement order; invalid → 3:4. */
  aspects: number[];
  gap?: number;
  /** Insert mode: logo aspect + "space around logo" (% of logo height). */
  hole?: { logoAspect?: number; paddingPct: number } | null;
}): MosaicLayout {
  const { containerW, bandH } = opts;
  const gap = opts.gap ?? 4;
  const aspects = opts.aspects.map((ar) =>
    Number.isFinite(ar) && ar > 0.2 && ar < 5 ? ar : MOSAIC_TILE_AR
  );

  for (let rows = Math.max(1, Math.round(opts.rows)); rows >= 1; rows--) {
    const layout = tryLayout(containerW, bandH, rows, aspects, gap, opts.hole ?? null);
    // Shed a row when the pool ran dry — an empty row, or a row stretched
    // past ~1.8× nominal — and retry fewer, fuller rows instead.
    if (rows === 1 || (layout.rowsFilled === rows && layout.maxStretch <= 1.8)) {
      return layout.result;
    }
  }
  // Unreachable (rows=1 always returns), but keep the compiler honest.
  return { rows: 1, rowH: bandH, tiles: [], hole: null };
}

function tryLayout(
  containerW: number,
  bandH: number,
  rows: number,
  aspects: number[],
  gap: number,
  holeOpts: { logoAspect?: number; paddingPct: number } | null
): { result: MosaicLayout; maxStretch: number; rowsFilled: number } {
  const rowH = (bandH - gap * (rows - 1)) / rows;

  // ── Hole geometry (insert mode) ──
  let hole: MosaicHoleRect | null = null;
  let holeRows: { start: number; end: number } | null = null;
  if (holeOpts) {
    const logoAspect =
      holeOpts.logoAspect && holeOpts.logoAspect > 0 ? holeOpts.logoAspect : 2.5;
    const rowSpan = rows === 2 ? 2 : Math.max(1, rows - 2);
    const holeH = rowSpan * rowH + (rowSpan - 1) * gap;
    // Full-height holes drop the logo fraction — 60% of the whole band ×
    // a wide logo would swallow the wall.
    const logoH = holeH * (rowSpan === rows ? 0.35 : MOSAIC_INSERT_LOGO_H);
    const pad = Math.min(45, Math.max(0, holeOpts.paddingPct)) / 100;
    // Padding is relative to the logo's AVERAGE dimension, continuous in px —
    // the slider must visibly move the edge (the old column-snapped hole ate
    // the whole range), and height-only padding barely registers on wide
    // lockups (45% of a short logo's height is a sliver next to its width).
    const wantW = logoH * logoAspect + pad * logoH * (1 + logoAspect);
    // Keep at least a meaningful tile column on each side.
    const maxW = containerW - 2 * Math.max(rowH * 0.6, 48) - 2 * gap;
    const holeW = Math.min(wantW, maxW);
    if (holeW > 40) {
      const startRow = Math.floor((rows - rowSpan) / 2);
      hole = {
        x: (containerW - holeW) / 2,
        y: startRow * (rowH + gap),
        w: holeW,
        h: holeH,
        logoH,
      };
      holeRows = { start: startRow, end: startRow + rowSpan - 1 };
    }
  }

  // ── Fill rows (greedy, in arrangement order — deterministic) ──
  const tiles: MosaicTileRect[] = [];
  let t = 0;
  let maxStretch = 1;
  let rowsFilled = 0;

  for (let r = 0; r < rows; r++) {
    const y = r * (rowH + gap);
    const tilesBefore = tiles.length;
    const inHole = holeRows && r >= holeRows.start && r <= holeRows.end;
    const segments: { x: number; w: number }[] =
      inHole && hole
        ? [
            { x: 0, w: hole.x - gap },
            { x: hole.x + hole.w + gap, w: containerW - (hole.x + hole.w + gap) },
          ]
        : [{ x: 0, w: containerW }];

    for (const seg of segments) {
      if (seg.w < 24) continue;
      // Take tiles until their nominal widths cover the segment.
      const take: number[] = [];
      let sumW = 0;
      while (t < aspects.length) {
        take.push(t);
        sumW += aspects[t] * rowH;
        t++;
        if (sumW + gap * (take.length - 1) >= seg.w) break;
      }
      if (take.length === 0) continue;
      const usable = seg.w - gap * (take.length - 1);
      const s = usable / sumW;
      maxStretch = Math.max(maxStretch, s);
      let x = seg.x;
      for (let i = 0; i < take.length; i++) {
        // Last tile in the segment absorbs rounding so the edge stays flush.
        const w =
          i === take.length - 1
            ? seg.x + seg.w - x
            : aspects[take[i]] * rowH * s;
        tiles.push({ x, y, w, h: rowH });
        x += w + gap;
      }
    }
    if (tiles.length > tilesBefore) rowsFilled++;
  }

  // rowsFilled < rows or maxStretch > 1.8 signals the pool ran dry mid-wall;
  // layoutMosaic sheds a row and retries with the same pool.
  return { result: { rows, rowH, tiles, hole }, maxStretch, rowsFilled };
}

export interface CropWindow {
  /** Scaled source size and the extract offset, all in px of the scaled image. */
  scaledW: number;
  scaledH: number;
  left: number;
  top: number;
}

/**
 * Cover-crop window anchored on a focal point: scale the source to cover
 * the destination box, then slide the window so the focal point sits as
 * close to the box center as the crop allows. Focal is 0–100 (the
 * images.focal_x/focal_y convention). Shared by the raster composer (sharp
 * resize+extract) and any math that must agree with CSS object-position.
 */
export function focalCropWindow(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  focalX: number,
  focalY: number
): CropWindow {
  const s = Math.max(dstW / srcW, dstH / srcH);
  const scaledW = Math.max(dstW, Math.round(srcW * s));
  const scaledH = Math.max(dstH, Math.round(srcH * s));
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  return {
    scaledW,
    scaledH,
    left: Math.round(clamp((focalX / 100) * scaledW - dstW / 2, 0, scaledW - dstW)),
    top: Math.round(clamp((focalY / 100) * scaledH - dstH / 2, 0, scaledH - dstH)),
  };
}
