import { describe, it, expect } from "vitest";
import { distributeIntoColumns } from "./grid-layout";

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
