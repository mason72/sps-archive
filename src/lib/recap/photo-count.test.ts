import { describe, expect, it } from "vitest";
import { countDistinctPhotos, readPhotoCountRows, type PhotoCountRow } from "./photo-count";

const row = (id: string, f: string | null, name: string | null = null): PhotoCountRow => ({
  id,
  original_filename: f,
  parsed_name: name,
});

describe("countDistinctPhotos", () => {
  it("counts a framed export and its clean print as one photo (F1 Cash App)", () => {
    const rows = [
      row("a1", "261022_F1_Cash_App_0042_v2.jpg"),
      row("a2", "261022_F1_Cash_App_0042_v2.jpg"),
      row("b1", "261022_F1_Cash_App_0043_v2.jpg"),
      row("b2", "261022_F1_Cash_App_0043_v2.jpg"),
    ];
    expect(countDistinctPhotos(rows)).toEqual({ photos: 2, named: 0 });
  });

  it("counts different filenames separately", () => {
    expect(countDistinctPhotos([row("a", "A.jpg"), row("b", "B.jpg"), row("c", "C.jpg")]).photos).toBe(3);
  });

  it("never merges rows that have no filename", () => {
    expect(countDistinctPhotos([row("a", null), row("b", null), row("c", "  ")]).photos).toBe(3);
  });

  it("counts a photo as named when any of its versions carries a name", () => {
    const rows = [row("a1", "Jane_Doe_01.jpg", null), row("a2", "Jane_Doe_01.jpg", "Jane Doe"), row("b", "IMG_9.jpg")];
    expect(countDistinctPhotos(rows)).toEqual({ photos: 2, named: 1 });
  });

  it("answers zero for no rows", () => {
    expect(countDistinctPhotos([])).toEqual({ photos: 0, named: 0 });
  });
});

/** A fake query over an in-memory table, honoring the id filter and the page range. */
function fakeTable(all: PhotoCountRow[], calls: Array<string[] | null>, failOnCall = -1) {
  return (ids: string[] | null) => {
    calls.push(ids);
    const callNo = calls.length - 1;
    const rows = (ids ? all.filter((r) => ids.includes(r.id)) : all).slice().sort((a, b) => a.id.localeCompare(b.id));
    return {
      order: () => ({
        range: async (from: number, to: number) =>
          callNo === failOnCall
            ? { data: null, error: { message: "boom" } }
            : { data: rows.slice(from, to + 1), error: null },
      }),
    };
  };
}

describe("readPhotoCountRows", () => {
  const all = Array.from({ length: 2500 }, (_, i) => row(`id${String(i).padStart(5, "0")}`, `f${i}.jpg`));

  it("reads every page of a whole-event share, past the 1,000-row cap", async () => {
    const calls: Array<string[] | null> = [];
    const got = await readPhotoCountRows(fakeTable(all, calls), null);
    expect(got).toHaveLength(2500);
    expect(calls.every((c) => c === null)).toBe(true);
  });

  it("splits a hand-picked set into id lists of at most 100", async () => {
    const calls: Array<string[] | null> = [];
    const picked = new Set(all.slice(0, 250).map((r) => r.id));
    const got = await readPhotoCountRows(fakeTable(all, calls), picked);
    expect(got).toHaveLength(250);
    expect(calls.map((c) => c?.length)).toEqual([100, 100, 50]);
  });

  it("throws on a failed read instead of counting what it got", async () => {
    const calls: Array<string[] | null> = [];
    const picked = new Set(all.slice(0, 250).map((r) => r.id));
    await expect(readPhotoCountRows(fakeTable(all, calls, 1), picked)).rejects.toMatchObject({ message: "boom" });
  });
});
