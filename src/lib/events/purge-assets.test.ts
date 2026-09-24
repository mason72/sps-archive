import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteImageAssets = vi.fn<(key: string, mediaType?: string | null) => Promise<string[]>>();
const deleteR2Prefix = vi.fn<(prefix: string) => Promise<{ deleted: number; failedKeys: string[] }>>();
vi.mock("@/lib/r2/client", () => ({
  deleteImageAssets: (k: string, m?: string | null) => deleteImageAssets(k, m),
  deleteR2Prefix: (p: string) => deleteR2Prefix(p),
}));

import { collectEventAssets, purgeEventAssets, purgeEventOwnedFiles } from "./purge-assets";

/** Minimal PostgREST stand-in: `images` rows, recording each call's shape. */
function fakeDb(rows: { event_id: string; r2_key: string; media_type: string | null; id: string }[]) {
  const calls: { ordered: boolean }[] = [];
  const db = {
    from: () => {
      let filtered = rows;
      let ordered = false;
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => { filtered = filtered.filter((r) => r.event_id === v); return q; },
        order: () => { ordered = true; filtered = [...filtered].sort((a, b) => a.id.localeCompare(b.id)); return q; },
        range: (from: number, to: number) => { calls.push({ ordered }); return Promise.resolve({ data: filtered.slice(from, to + 1), error: null }); },
        in: (_c: string, keys: string[]) => Promise.resolve({ data: rows.filter((r) => keys.includes(r.r2_key)), error: null }),
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

beforeEach(() => {
  deleteImageAssets.mockReset().mockResolvedValue([]);
});

describe("collectEventAssets", () => {
  it("pages in id order and collects every key across pages, once", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      id: String(i).padStart(5, "0"), event_id: "e1", r2_key: `events/e1/originals/${i}.jpg`, media_type: null,
    }));
    const { db, calls } = fakeDb(rows);
    const assets = await collectEventAssets(db, "e1");
    expect(assets.size).toBe(2500);
    expect(calls.length).toBe(3);
    expect(calls.every((c) => c.ordered)).toBe(true);
  });
});

describe("purgeEventAssets", () => {
  it("keeps a file another event's row still points at (a merged frame)", async () => {
    // Rows of the deleted event are already gone; this row was moved into
    // the kept event and still carries the deleted event's folder.
    const { db } = fakeDb([{ id: "1", event_id: "kept", r2_key: "events/gone/originals/moved.jpg", media_type: null }]);
    const assets = new Map([["events/gone/originals/moved.jpg", null], ["events/gone/originals/x.jpg", null]]);
    const res = await purgeEventAssets(db, assets);
    expect(res).toEqual({ deleted: 1, kept: 1, failedKeys: [] });
    expect(deleteImageAssets).toHaveBeenCalledTimes(1);
    expect(deleteImageAssets).toHaveBeenCalledWith("events/gone/originals/x.jpg", null);
  });

  it("surfaces failed object keys instead of swallowing them", async () => {
    deleteImageAssets.mockImplementation(async (k) => (k.endsWith("b.jpg") ? [k, `${k}-thumb`] : []));
    const { db } = fakeDb([]);
    const assets = new Map([["events/g/originals/a.jpg", null], ["events/g/originals/b.jpg", "video"]]);
    const res = await purgeEventAssets(db, assets);
    expect(res.deleted).toBe(2);
    expect(res.failedKeys).toEqual(["events/g/originals/b.jpg", "events/g/originals/b.jpg-thumb"]);
    expect(deleteImageAssets).toHaveBeenCalledWith("events/g/originals/b.jpg", "video");
  });
});

describe("purgeEventOwnedFiles", () => {
  it("clears exactly the three owned folders, never the event root or images", async () => {
    deleteR2Prefix.mockReset().mockImplementation(async (p) => ({ deleted: 1, failedKeys: p.includes("covers") ? [`${p}cover-raster.jpg`] : [] }));
    const res = await purgeEventOwnedFiles("e1");
    expect(deleteR2Prefix.mock.calls.map((c) => c[0])).toEqual([
      "events/e1/branding/", "events/e1/covers/", "events/e1/attachments/",
    ]);
    expect(res).toEqual({ deleted: 3, failedKeys: ["events/e1/covers/cover-raster.jpg"] });
  });
});
