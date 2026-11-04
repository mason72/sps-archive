import { describe, expect, it } from "vitest";
import { countAcross, fetchPagesInWaves, readAllRows, type Pageable } from "./paged";
import { describeError } from "@/lib/monitoring/report";

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

describe("fetchPagesInWaves", () => {
  it("never has more than inFlight pages outstanding, and keeps page order", async () => {
    let open = 0;
    let peak = 0;
    const asked: number[] = [];
    const page = async (i: number) => {
      asked.push(i);
      open++;
      peak = Math.max(peak, open);
      // Later pages answer FIRST, so order can only come from the helper.
      await new Promise((r) => setTimeout(r, 10 - (i % 4)));
      open--;
      return { data: `page-${i}`, error: null };
    };
    const got = await fetchPagesInWaves(page, 1, 10, 4);
    expect(got.map((r) => r.data)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `page-${i}`));
    expect(peak).toBe(4);
    expect(asked).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("asks for nothing when the range is empty", async () => {
    let calls = 0;
    const page = async () => ({ data: calls++, error: null });
    expect(await fetchPagesInWaves(page, 1, 1)).toEqual([]);
    expect(await fetchPagesInWaves(page, 1, 0)).toEqual([]);
    expect(calls).toBe(0);
  });

  it("throws the first error and asks for no later wave", async () => {
    const asked: number[] = [];
    const page = async (i: number) => {
      asked.push(i);
      return { data: i, error: i === 2 ? { message: "statement timeout" } : null };
    };
    await expect(fetchPagesInWaves(page, 1, 12, 4)).rejects.toEqual({
      message: "statement timeout",
    });
    // Wave 1 is pages 1-4; nothing after it may be asked for.
    expect(asked).toEqual([1, 2, 3, 4]);
  });
});

describe("countAcross", () => {
  const ids = Array.from({ length: 1457 }, (_, i) => `id-${i}`);

  it("never sends more than 100 ids in one request, and sums every chunk", async () => {
    const sizes: number[] = [];
    const total = await countAcross(ids, "images", async (chunk) => {
      sizes.push(chunk.length);
      return { count: chunk.length * 2, error: null, status: 200 };
    });
    expect(Math.max(...sizes)).toBe(100);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(1457);
    expect(sizes).toHaveLength(15);
    expect(total).toBe(1457 * 2);
  });

  it("puts the HTTP status into the error a bodiless HEAD failure leaves empty", async () => {
    await expect(
      countAcross(ids, "images", async () => ({ count: null, error: { message: "" }, status: 400 }))
    ).rejects.toThrow("images count failed: HTTP 400");
  });

  it("refuses a chunk that answered without a count instead of adding 0", async () => {
    await expect(
      countAcross(ids, "images", async () => ({ count: null, error: null, status: 204 }))
    ).rejects.toThrow("images count failed: HTTP 204 with no count");
  });

  it("counts nothing for no ids without a request", async () => {
    let calls = 0;
    const total = await countAcross([], "favorites", async () => {
      calls++;
      return { count: 1, error: null, status: 200 };
    });
    expect(total).toBe(0);
    expect(calls).toBe(0);
  });
});

describe("describeError on an empty PostgREST error", () => {
  it("says where the status is instead of printing {\"message\":\"\"}", () => {
    expect(describeError({ message: "" })).toMatch(/empty body.*edge logs/);
  });
  it("still prints a real message as is", () => {
    expect(describeError({ message: "boom", code: "57014" })).toBe("boom (code 57014)");
  });
});
