import { describe, it, expect } from "vitest";
import {
  selectMosaicTiles,
  selectCrossfadeImages,
  computeMosaicGrid,
  computeInsertHole,
  holeCells,
  cellInHole,
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

describe("computeMosaicGrid", () => {
  it("derives columns from container at ~3:4 tiles", () => {
    const g = computeMosaicGrid({ containerW: 1600, bandH: 600, rows: 3, poolSize: 100 });
    expect(g.rows).toBe(3);
    // tile height 200 → ideal tile width 150 → ~10-11 columns
    expect(g.cols).toBe(Math.round(1600 / (200 * MOSAIC_TILE_AR)));
    expect(g.cells).toBe(g.rows * g.cols);
  });

  it("sheds rows (never repeats tiles) when the pool is small", () => {
    const g = computeMosaicGrid({ containerW: 1600, bandH: 600, rows: 4, poolSize: 15 });
    expect(g.rows).toBeLessThan(4);
    expect(g.rows * g.cols).toBeLessThanOrEqual(15);
  });

  it("degrades to a single partial row for tiny pools", () => {
    const g = computeMosaicGrid({ containerW: 1600, bandH: 600, rows: 3, poolSize: 4 });
    expect(g.rows).toBe(1);
    expect(g.cols).toBe(4);
  });
});

describe("computeInsertHole", () => {
  const grid = (rows: number, cols: number) => ({
    rows,
    cols,
    tileW: 150,
    tileH: 200,
    cells: rows * cols,
  });

  it("leaves a full tile row above and below on a 4-row grid", () => {
    const hole = computeInsertHole({ grid: grid(4, 11), logoAspect: 2.5, paddingPct: 15 });
    expect(hole).not.toBeNull();
    expect(hole!.rowSpan).toBe(2);
    expect(hole!.startRow).toBe(1);
  });

  it("goes full-height on a 2-row grid", () => {
    const hole = computeInsertHole({ grid: grid(2, 10), logoAspect: 2.5, paddingPct: 15 });
    expect(hole!.rowSpan).toBe(2);
    expect(hole!.startRow).toBe(0);
  });

  it("center-snaps: hole parity matches column parity", () => {
    for (const cols of [9, 10, 11, 12]) {
      for (const ar of [1, 2, 3.5]) {
        const hole = computeInsertHole({ grid: grid(4, cols), logoAspect: ar, paddingPct: 10 });
        if (!hole) continue;
        expect((cols - hole.colSpan) % 2).toBe(0);
        expect(hole.startCol).toBe((cols - hole.colSpan) / 2);
        expect(hole.colSpan).toBeLessThanOrEqual(cols - 2);
      }
    }
  });

  it("declines a hole when the grid is too small", () => {
    expect(computeInsertHole({ grid: grid(1, 4), logoAspect: 2.5, paddingPct: 10 })).toBeNull();
  });

  it("wider padding widens the hole", () => {
    const tight = computeInsertHole({ grid: grid(4, 20), logoAspect: 2.5, paddingPct: 0 })!;
    const loose = computeInsertHole({ grid: grid(4, 20), logoAspect: 2.5, paddingPct: 40 })!;
    expect(loose.colSpan).toBeGreaterThanOrEqual(tight.colSpan);
  });

  it("holeCells and cellInHole agree", () => {
    const g = grid(4, 11);
    const hole = computeInsertHole({ grid: g, logoAspect: 2.5, paddingPct: 15 })!;
    let counted = 0;
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++) if (cellInHole(hole, r, c)) counted++;
    expect(counted).toBe(holeCells(hole));
  });
});
