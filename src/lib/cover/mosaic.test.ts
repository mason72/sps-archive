import { describe, it, expect } from "vitest";
import {
  selectMosaicTiles,
  selectCrossfadeImages,
  layoutMosaic,
  MOSAIC_TILE_AR,
} from "./mosaic";

function img(name: string, n: number) {
  return {
    id: `${name}-${n}`,
    parsedName: name,
    originalFilename: `${name}-${n}.jpg`,
  };
}

/** A booth-style pool: `people` distinct people × `shots` near-dupes each. */
function pool(people: number, shots = 3) {
  const out: ReturnType<typeof img>[] = [];
  for (let p = 0; p < people; p++) {
    for (let s = 0; s < shots; s++) out.push(img(`Person${p}`, s));
  }
  return out;
}

describe("selectMosaicTiles", () => {
  it("dedupes to one tile per person stack", () => {
    const tiles = selectMosaicTiles(pool(10, 3), 1, 30);
    expect(tiles).toHaveLength(10);
    const people = new Set(tiles.map((t) => t.parsedName));
    expect(people.size).toBe(10);
  });

  it("takes each stack's lead image", () => {
    const tiles = selectMosaicTiles(pool(5, 3), 1, 5);
    for (const t of tiles) expect(t.id.endsWith("-0")).toBe(true);
  });

  it("is deterministic for a seed and reorders across seeds", () => {
    const p = pool(24, 2);
    const a1 = selectMosaicTiles(p, 7, 12).map((t) => t.id);
    const a2 = selectMosaicTiles(p, 7, 12).map((t) => t.id);
    expect(a1).toEqual(a2);
    const ids = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5]) {
      ids.add(selectMosaicTiles(p, seed, 12).map((t) => t.id).join(","));
    }
    expect(ids.size).toBeGreaterThan(1);
  });

  it("caps at count", () => {
    expect(selectMosaicTiles(pool(40, 1), 1, 12)).toHaveLength(12);
  });
});

describe("selectCrossfadeImages", () => {
  it("keeps section order and dedupes people", () => {
    const picks = selectCrossfadeImages(pool(8, 3), 5);
    expect(picks.map((p) => p.parsedName)).toEqual([
      "Person0",
      "Person1",
      "Person2",
      "Person3",
      "Person4",
    ]);
  });
});

/** Mixed portrait/landscape aspect pool, like a real photo-booth section. */
function aspects(n: number): number[] {
  const cycle = [0.75, 1.5, 0.8, 1.0, 0.67, 1.78, 0.75];
  return Array.from({ length: n }, (_, i) => cycle[i % cycle.length]);
}

const W = 1600;
const H = 600;
const GAP = 4;

describe("layoutMosaic — justified rows", () => {
  it("keeps the requested rows with one shared height and flush edges", () => {
    const l = layoutMosaic({ containerW: W, bandH: H, rows: 3, aspects: aspects(80), gap: GAP });
    expect(l.rows).toBe(3);
    const ys = [...new Set(l.tiles.map((t) => Math.round(t.y)))].sort((a, b) => a - b);
    expect(ys).toHaveLength(3);
    // Every row ends exactly at the right edge, and rows fill the band.
    for (const y of ys) {
      const row = l.tiles.filter((t) => Math.round(t.y) === y);
      const right = Math.max(...row.map((t) => t.x + t.w));
      expect(right).toBeCloseTo(W, 3);
    }
    const bottom = Math.max(...l.tiles.map((t) => t.y + t.h));
    expect(bottom).toBeCloseTo(H, 3);
  });

  it("tiles keep ~their natural aspect (no uniform-cell crop)", () => {
    const pool = aspects(80);
    const l = layoutMosaic({ containerW: W, bandH: H, rows: 3, aspects: pool, gap: GAP });
    // Rendered aspect vs natural aspect: justification residual stays small
    // for all but the flush-edge absorber tiles.
    let within = 0;
    l.tiles.forEach((t, i) => {
      const natural = pool[i];
      const rendered = t.w / t.h;
      if (Math.abs(rendered - natural) / natural < 0.25) within++;
    });
    expect(within / l.tiles.length).toBeGreaterThan(0.85);
    // And the widths genuinely vary — this is not a uniform grid.
    const widths = new Set(l.tiles.map((t) => Math.round(t.w)));
    expect(widths.size).toBeGreaterThan(5);
  });

  it("is deterministic and consumes tiles in arrangement order", () => {
    const a = layoutMosaic({ containerW: W, bandH: H, rows: 3, aspects: aspects(50), gap: GAP });
    const b = layoutMosaic({ containerW: W, bandH: H, rows: 3, aspects: aspects(50), gap: GAP });
    expect(a).toEqual(b);
  });

  it("sheds rows rather than stretching a dry pool", () => {
    const l = layoutMosaic({ containerW: W, bandH: H, rows: 4, aspects: aspects(8), gap: GAP });
    expect(l.rows).toBeLessThan(4);
    expect(l.tiles.length).toBeLessThanOrEqual(8);
  });

  it("survives a tiny pool on a single row", () => {
    const l = layoutMosaic({ containerW: W, bandH: H, rows: 3, aspects: aspects(2), gap: GAP });
    expect(l.rows).toBe(1);
    expect(l.tiles.length).toBeGreaterThan(0);
  });

  it("falls back to 3:4 for junk aspect values", () => {
    const l = layoutMosaic({
      containerW: W,
      bandH: H,
      rows: 2,
      aspects: [NaN, 0, -3, Infinity, 99, ...aspects(40)],
      gap: GAP,
    });
    expect(l.tiles.length).toBeGreaterThan(10);
    for (const t of l.tiles) expect(t.w).toBeGreaterThan(0);
  });
});

describe("layoutMosaic — insert hole", () => {
  const hole = (paddingPct: number, rows = 3, logoAspect = 2.5) =>
    layoutMosaic({
      containerW: W,
      bandH: H,
      rows,
      aspects: aspects(80),
      gap: GAP,
      hole: { logoAspect, paddingPct },
    }).hole!;

  it("row-snaps vertically: one full tile row above and below (3→1, 4→2)", () => {
    const h3 = hole(15, 3);
    const rowH3 = (H - 2 * GAP) / 3;
    expect(h3.y).toBeCloseTo(rowH3 + GAP, 3);
    expect(h3.h).toBeCloseTo(rowH3, 3);
    const h4 = hole(15, 4);
    const rowH4 = (H - 3 * GAP) / 4;
    expect(h4.h).toBeCloseTo(rowH4 * 2 + GAP, 3);
  });

  it("padding slider MOVES the edge — every step changes the width (the dead-slider regression)", () => {
    const widths = [0, 10, 20, 30, 45].map((p) => hole(p).w);
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
  });

  it("stays centered and leaves tiles on both sides", () => {
    const h = hole(45, 3, 4); // wide logo, max padding
    expect(h.x + h.w / 2).toBeCloseTo(W / 2, 3);
    expect(h.x).toBeGreaterThan(40);
    const l = layoutMosaic({
      containerW: W,
      bandH: H,
      rows: 3,
      aspects: aspects(80),
      gap: GAP,
      hole: { logoAspect: 4, paddingPct: 45 },
    });
    const midRowTiles = l.tiles.filter(
      (t) => t.y < h.y + 1 && t.y + t.h > h.y + 1
    );
    const leftOf = midRowTiles.filter((t) => t.x + t.w <= h.x + 1);
    const rightOf = midRowTiles.filter((t) => t.x >= h.x + h.w - 1);
    expect(leftOf.length).toBeGreaterThan(0);
    expect(rightOf.length).toBeGreaterThan(0);
    expect(leftOf.length + rightOf.length).toBe(midRowTiles.length); // none under the hole
  });

  it("2-row band gets a full-height hole with a reduced logo", () => {
    const h = hole(15, 2);
    expect(h.y).toBe(0);
    expect(h.h).toBeCloseTo(H, 3);
    expect(h.logoH).toBeCloseTo(H * 0.35, 3);
  });

  it("no tile overlaps the hole on any row", () => {
    const l = layoutMosaic({
      containerW: W,
      bandH: H,
      rows: 4,
      aspects: aspects(120),
      gap: GAP,
      hole: { logoAspect: 2.5, paddingPct: 20 },
    });
    const h = l.hole!;
    for (const t of l.tiles) {
      const xOverlap = t.x < h.x + h.w && t.x + t.w > h.x;
      const yOverlap = t.y < h.y + h.h && t.y + t.h > h.y;
      expect(xOverlap && yOverlap).toBe(false);
    }
  });
});
