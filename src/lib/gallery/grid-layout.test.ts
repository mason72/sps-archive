import { describe, it, expect } from "vitest";
import {
  distributeIntoColumns,
  distributeBalanced,
  tileHeightUnit,
} from "./grid-layout";

describe("distributeIntoColumns — left-to-right reading order", () => {
  it("places item i in column i % n (reads across the first row, then wraps)", () => {
    const cols = distributeIntoColumns([0, 1, 2, 3, 4, 5, 6], 3);
    // Row-major: first row = first item of each column.
    expect(cols).toEqual([
      [0, 3, 6],
      [1, 4],
      [2, 5],
    ]);
  });

  it("REGRESSION: a sorted sequence reads left-to-right across the top", () => {
    // First item of each column (the visible top row) is the sorted prefix.
    const sorted = ["a", "b", "c", "d", "e"];
    const cols = distributeIntoColumns(sorted, 3);
    const topRow = cols.map((c) => c[0]);
    expect(topRow).toEqual(["a", "b", "c"]);
  });

  it("handles fewer items than columns", () => {
    const cols = distributeIntoColumns([0, 1], 4);
    expect(cols).toEqual([[0], [1], [], []]);
  });

  it("guards against zero columns (never divides by zero)", () => {
    const cols = distributeIntoColumns([0, 1, 2], 0);
    expect(cols).toEqual([[0, 1, 2]]);
  });
});

describe("distributeBalanced — shortest-column-first (height-balanced)", () => {
  const colHeights = (cols: { h: number }[][]) =>
    cols.map((c) => c.reduce((s, i) => s + i.h, 0));

  it("first row reads left-to-right (ties → leftmost)", () => {
    const items = [{ h: 1 }, { h: 1 }, { h: 1 }];
    const cols = distributeBalanced(items, 3, (i) => i.h);
    expect(cols.map((c) => c.length)).toEqual([1, 1, 1]);
    // each item in its own column, in order
    expect(cols[0][0]).toBe(items[0]);
    expect(cols[1][0]).toBe(items[1]);
    expect(cols[2][0]).toBe(items[2]);
  });

  it("sends the next item to the shortest column, not round-robin", () => {
    // Two columns. A tall item then three short ones: the tall column should
    // not receive a second item until the short column catches up.
    const tall = { h: 3 };
    const s1 = { h: 1 };
    const s2 = { h: 1 };
    const s3 = { h: 1 };
    const cols = distributeBalanced([tall, s1, s2, s3], 2, (i) => i.h);
    // col0 = [tall(3)], col1 = [s1(1), s2(1), s3(1)] → heights 3 vs 3, balanced.
    expect(colHeights(cols)).toEqual([3, 3]);
    expect(cols[0]).toEqual([tall]);
    expect(cols[1]).toEqual([s1, s2, s3]);
  });

  it("keeps columns far more even than round-robin for clustered tall tiles", () => {
    // Alternating tall/short. Round-robin (i%2) would pile all tall in col0.
    const items = [
      { h: 3 }, { h: 1 }, { h: 3 }, { h: 1 }, { h: 3 }, { h: 1 },
    ];
    const balanced = colHeights(distributeBalanced(items, 2, (i) => i.h));
    const spread = Math.max(...balanced) - Math.min(...balanced);
    expect(spread).toBeLessThanOrEqual(2); // round-robin spread would be 6
  });

  it("falls back to a positive height when getHeightUnit yields 0/NaN", () => {
    const items = [{ h: 0 }, { h: NaN }, { h: 0 }];
    const cols = distributeBalanced(items, 3, (i) => i.h);
    expect(cols.map((c) => c.length)).toEqual([1, 1, 1]); // still distributes
  });

  it("guards against zero columns", () => {
    const cols = distributeBalanced([{ h: 1 }, { h: 1 }], 0, (i) => i.h);
    expect(cols.length).toBe(1);
    expect(cols[0].length).toBe(2);
  });
});

describe("tileHeightUnit", () => {
  const portrait = { width: 2000, height: 3000 }; // h/w = 1.5
  const landscape = { width: 3000, height: 2000 }; // h/w = 0.667

  it("gives a stack the height it actually renders at, not its cover's aspect", () => {
    // The regression: a collapsed stack renders in a fixed aspect-[3/4] box, so
    // its cover being portrait or landscape must make no difference at all.
    expect(tileHeightUnit({ type: "stack" }, false)).toBeCloseTo(4 / 3);
  });

  it("uses natural aspect for a flat image", () => {
    expect(tileHeightUnit({ type: "image", data: portrait }, false)).toBeCloseTo(1.5);
    expect(tileHeightUnit({ type: "image", data: landscape }, false)).toBeCloseTo(2 / 3);
  });

  it("is 1 for every tile in uniform style, stacks included", () => {
    expect(tileHeightUnit({ type: "image", data: portrait }, true)).toBe(1);
    expect(tileHeightUnit({ type: "image", data: landscape }, true)).toBe(1);
    expect(tileHeightUnit({ type: "stack" }, true)).toBe(1);
  });

  it("falls back to the same 3:4 box GridImage renders when dimensions are unknown", () => {
    expect(tileHeightUnit({ type: "image", data: {} }, false)).toBeCloseTo(4 / 3);
    expect(
      tileHeightUnit({ type: "image", data: { width: null, height: null } }, false)
    ).toBeCloseTo(4 / 3);
    // A zero dimension is corrupt data, not a 0-height tile.
    expect(
      tileHeightUnit({ type: "image", data: { width: 0, height: 0 } }, false)
    ).toBeCloseTo(4 / 3);
  });

  it("balances a mixed stack/image grid on rendered heights", () => {
    // Two stacks with wildly different covers must pack as equal-height tiles.
    const items = [
      { type: "stack" as const },
      { type: "stack" as const },
      { type: "image" as const, data: portrait },
      { type: "image" as const, data: portrait },
    ];
    const cols = distributeBalanced(items, 2, (i) => tileHeightUnit(i, false));
    expect(cols).toHaveLength(2);
    const height = (col: typeof items) =>
      col.reduce((sum, i) => sum + tileHeightUnit(i, false), 0);
    expect(height(cols[0])).toBeCloseTo(height(cols[1]));
  });
});
