import { describe, expect, it } from "vitest";
import { readAllRows, type Pageable } from "./paged";

/** A fake table that answers ordered pages the way PostgREST would. */
function fakeTable(count: number) {
  const calls: Array<{ from: number; to: number; ordered: boolean }> = [];
  const all = Array.from({ length: count }, (_, i) => ({ id: i }));
  const make = (): Pageable<{ id: number }> => ({
    order: (column) => {
      expect(column).toBe("id");
      return {
        range: async (from, to) => {
          calls.push({ from, to, ordered: true });
          return { data: all.slice(from, to + 1), error: null };
        },
      };
    },
  });
  return { make, calls };
}

describe("readAllRows", () => {
  it("reads past the cap: 1,382 rows arrive as 1,382, not 1,000", async () => {
    const { make, calls } = fakeTable(1382);
    const rows = await readAllRows(make);
    expect(rows).toHaveLength(1382);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1382);
    expect(calls.map((c) => [c.from, c.to])).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("asks for one more page when a page is exactly full", async () => {
    // 1,000 rows is indistinguishable from "capped" — the only proof the table
    // ends is an empty page after it.
    const { make, calls } = fakeTable(1000);
    const rows = await readAllRows(make);
    expect(rows).toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("stops on the first short page", async () => {
    const { make, calls } = fakeTable(28);
    expect(await readAllRows(make)).toHaveLength(28);
    expect(calls).toHaveLength(1);
  });

  it("builds a fresh query per page and orders every page", async () => {
    let built = 0;
    const { make } = fakeTable(2500);
    await readAllRows(() => {
      built++;
      return make();
    });
    expect(built).toBe(3);
  });

  it("throws the page's error instead of returning a partial read", async () => {
    const make = (): Pageable<{ id: number }> => ({
      order: () => ({
        range: async () => ({ data: null, error: { message: "statement timeout" } }),
      }),
    });
    await expect(readAllRows(make)).rejects.toEqual({ message: "statement timeout" });
  });
});
