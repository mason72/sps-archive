import { describe, it, expect } from "vitest";
import {
  IA_MIN_BYTES,
  classifyForIa,
  nextStartAfter,
  runTieringPass,
  type ListedObject,
  type TieringDeps,
} from "./tiering";

const NOW = new Date("2026-10-20T12:00:00Z");
const OLD = new Date("2026-08-01T00:00:00Z");
const YOUNG = new Date("2026-10-10T00:00:00Z");
const MB = IA_MIN_BYTES;
const none = new Set<string>();

function orig(key: string, over: Partial<ListedObject> = {}): ListedObject {
  return { Key: key, Size: 3 * MB, LastModified: OLD, StorageClass: "STANDARD", ETag: `"${key}"`, ...over };
}

describe("classifyForIa", () => {
  it("moves an old, large, standard original", () => {
    expect(classifyForIa(orig("events/e/originals/a.jpg"), NOW, none)).toBe("move");
  });
  it("treats a missing StorageClass (how R2 HEAD reports standard) as standard", () => {
    expect(classifyForIa(orig("events/e/originals/a.jpg", { StorageClass: undefined }), NOW, none)).toBe("move");
  });
  it("never touches thumbnails or other folders", () => {
    for (const k of [
      "events/e/thumbnails/thumb-lg/a.jpg",
      "events/e/covers/cover-raster.jpg",
      "events/e/originals/",
      "branding/x.png",
      "zips/z.zip",
    ]) expect(classifyForIa(orig(k), NOW, none)).toBe("not-original");
  });
  it("skips what is already moved, young, small, video, excluded or of unknown age", () => {
    expect(classifyForIa(orig("events/e/originals/a.jpg", { StorageClass: "STANDARD_IA" }), NOW, none)).toBe("already");
    expect(classifyForIa(orig("events/e/originals/a.jpg", { LastModified: YOUNG }), NOW, none)).toBe("young");
    expect(classifyForIa(orig("events/e/originals/a.jpg", { Size: MB - 1 }), NOW, none)).toBe("small");
    expect(classifyForIa(orig("events/e/originals/a.MP4"), NOW, none)).toBe("video");
    expect(classifyForIa(orig("events/e/originals/a.mov"), NOW, none)).toBe("video");
    expect(classifyForIa(orig("events/e/originals/a.jpg"), NOW, new Set(["events/e/originals/a.jpg"]))).toBe("excluded");
    expect(classifyForIa(orig("events/e/originals/a.jpg", { LastModified: undefined }), NOW, none)).toBe("unknown");
    expect(classifyForIa(orig("events/e/originals/a.jpg", { ETag: undefined }), NOW, none)).toBe("unknown");
  });
  it("puts the 30-day edge on the moving side only once it has passed", () => {
    const edge = new Date(NOW.getTime() - 30 * 86400_000);
    expect(classifyForIa(orig("events/e/originals/a.jpg", { LastModified: edge }), NOW, none)).toBe("move");
    const justInside = new Date(edge.getTime() + 1);
    expect(classifyForIa(orig("events/e/originals/a.jpg", { LastModified: justInside }), NOW, none)).toBe("young");
  });
});

describe("nextStartAfter", () => {
  it("continues inside originals/", () => {
    expect(nextStartAfter("events/e1/originals/b.jpg")).toBe("events/e1/originals/b.jpg");
  });
  it("jumps from thumbnails (or anything after originals) past the whole event", () => {
    const next = nextStartAfter("events/e1/thumbnails/thumb-md/b.jpg");
    expect(next).toBe("events/e10");
    expect("events/e1/video/x.mp4" < next).toBe(true);
    expect("events/e1/été/x.jpg" < next).toBe(true);
    expect("events/e2/originals/a.jpg" > next).toBe(true);
  });
  it("orders folder names with their slash, as the listing does", () => {
    // "originals-old/" lists BEFORE "originals/" ("-" < "/"), so it must jump
    // into originals/, not past the event.
    expect(nextStartAfter("events/e1/originals-old/x.jpg")).toBe("events/e1/originals/");
    expect(nextStartAfter("events/e1/originals.bak/x.jpg")).toBe("events/e1/originals/");
    expect(nextStartAfter("events/e1/originalsZ/x.jpg")).toBe("events/e10");
  });
  it("jumps from a folder before originals into originals/", () => {
    const next = nextStartAfter("events/e1/branding/logo.png");
    expect(next).toBe("events/e1/originals/");
    expect("events/e1/originals/a.jpg" > next).toBe(true);
    expect("events/e1/covers/c.jpg" < next).toBe(true);
  });
});

/** A fake bucket: sorted keys, StartAfter semantics, `pageSize` keys per page. */
function fakeBucket(objects: ListedObject[], pageSize: number, failKeys = new Set<string>()) {
  const sorted = [...objects].sort((a, b) => (a.Key! < b.Key! ? -1 : 1));
  const copied: string[] = [];
  const listCalls: (string | undefined)[] = [];
  const deps: TieringDeps = {
    async list(startAfter) {
      listCalls.push(startAfter);
      const rest = sorted.filter((o) => startAfter === undefined || o.Key! > startAfter);
      return { objects: rest.slice(0, pageSize), truncated: rest.length > pageSize };
    },
    async copyToIa(key, etag) {
      if (failKeys.has(key)) throw Object.assign(new Error("boom"), { name: "InternalError" });
      expect(etag).toBe(`"${key}"`);
      copied.push(key);
    },
  };
  return { deps, copied, listCalls };
}

describe("runTieringPass", () => {
  const bucket = [
    orig("events/a/branding/logo.png"),
    orig("events/a/originals/1.jpg"),
    orig("events/a/originals/2.jpg", { LastModified: YOUNG }),
    orig("events/a/thumbnails/thumb-lg/1.jpg"),
    orig("events/a/thumbnails/thumb-lg/2.jpg"),
    orig("events/a/thumbnails/thumb-md/1.jpg"),
    orig("events/b/originals/3.jpg"),
    orig("events/b/originals/4.mp4"),
    orig("events/b/thumbnails/thumb-lg/3.jpg"),
  ];

  it("moves exactly the eligible originals across pages and wraps at the end", async () => {
    const { deps, copied } = fakeBucket(bucket, 2);
    const r = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    expect(copied.sort()).toEqual(["events/a/originals/1.jpg", "events/b/originals/3.jpg"]);
    expect(r.wrapped).toBe(true);
    expect(r.cursor).toBeNull();
    expect(r.counts).toMatchObject({ young: 1, video: 1 });
  });

  it("skips over an event's thumbnails instead of listing them all", async () => {
    const { deps, listCalls } = fakeBucket(bucket, 1);
    await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    expect(listCalls).toContain("events/a0");
    expect(listCalls).not.toContain("events/a/thumbnails/thumb-lg/1.jpg");
    expect(listCalls).toContain("events/a/originals/");
  });

  it("stops at maxPages and hands back a resumable cursor", async () => {
    const { deps, copied } = fakeBucket(bucket, 1);
    const r1 = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 2 });
    expect(r1.wrapped).toBe(false);
    expect(r1.cursor).not.toBeNull();
    const r2 = await runTieringPass(deps, { startAfter: r1.cursor, excluded: none, now: NOW, maxPages: 50 });
    expect(r2.wrapped).toBe(true);
    expect(copied.sort()).toEqual(["events/a/originals/1.jpg", "events/b/originals/3.jpg"]);
  });

  it("is a no-op on a second lap: moved objects list as STANDARD_IA", async () => {
    const objs = bucket.map((o) => ({ ...o }));
    const { deps } = fakeBucket(objs, 3);
    const first = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    for (const o of objs) if (["events/a/originals/1.jpg", "events/b/originals/3.jpg"].includes(o.Key!)) o.StorageClass = "STANDARD_IA";
    const again = fakeBucket(objs, 3);
    const second = await runTieringPass(again.deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    expect(first.moved).toBe(2);
    expect(second.moved).toBe(0);
    expect(again.copied).toEqual([]);
    expect(second.counts.already).toBe(2);
  });

  it("reports a failed copy, keeps walking, and does not count it as moved", async () => {
    const { deps, copied } = fakeBucket(bucket, 10, new Set(["events/a/originals/1.jpg"]));
    const r = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    expect(copied).toEqual(["events/b/originals/3.jpg"]);
    expect(r.failed.map((f) => f.key)).toEqual(["events/a/originals/1.jpg"]);
    expect(r.moved).toBe(1);
  });

  it("steps past ONE object that keeps failing instead of freezing the walk", async () => {
    const { deps, copied } = fakeBucket(bucket, 2, new Set(["events/a/originals/1.jpg"]));
    const r = await runTieringPass(deps, { startAfter: "events/a/branding/logo.png", excluded: none, now: NOW, maxPages: 50 });
    expect(r.stalled).toBe(false);
    expect(r.wrapped).toBe(true);
    expect(copied).toEqual(["events/b/originals/3.jpg"]);
    expect(r.failed).toHaveLength(1);
  });

  it("stalls in place when a page's copies all fail and there are several", async () => {
    const many = Array.from({ length: 6 }, (_, i) => orig(`events/c/originals/${i}.jpg`));
    const { deps } = fakeBucket(many, 10, new Set(many.map((o) => o.Key!)));
    const r = await runTieringPass(deps, { startAfter: "events/c/branding/x", excluded: none, now: NOW, maxPages: 50 });
    expect(r.stalled).toBe(true);
    expect(r.cursor).toBe("events/c/branding/x");
    expect(r.moved).toBe(0);
  });

  it("stops starting pages once the deadline has passed", async () => {
    const { deps, listCalls } = fakeBucket(bucket, 1);
    const r = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50, deadline: Date.now() - 1 });
    expect(r.outOfTime).toBe(true);
    expect(listCalls).toHaveLength(0);
    expect(r.cursor).toBeNull();
    expect(r.wrapped).toBe(false);
  });

  it("cuts mid-page at the hard deadline and leaves the cursor BEFORE that page", async () => {
    const many = Array.from({ length: 40 }, (_, i) => orig(`events/c/originals/${String(i).padStart(2, "0")}.jpg`));
    const { deps, copied } = fakeBucket(many, 1000);
    // Each copy advances a fake clock by 10 s; the hard deadline is at 50 s.
    let t = 0;
    const realCopy = deps.copyToIa;
    deps.copyToIa = async (k, e) => {
      await realCopy(k, e);
      t += 10_000;
    };
    const r = await runTieringPass(deps, {
      startAfter: "events/c/branding/x",
      excluded: none,
      now: NOW,
      maxPages: 50,
      concurrency: 1,
      deadline: 1_000_000,
      hardDeadline: 50_000,
      clock: () => t,
    });
    expect(r.outOfTime).toBe(true);
    expect(r.cursor).toBe("events/c/branding/x");
    expect(copied.length).toBe(5);
  });

  it("hands the cursor to onPage after every page, ending with the wrap", async () => {
    const { deps } = fakeBucket(bucket, 2);
    const seen: (string | null)[] = [];
    const r = await runTieringPass(deps, {
      startAfter: null,
      excluded: none,
      now: NOW,
      maxPages: 50,
      onPage: async (soFar) => {
        seen.push(soFar.cursor);
      },
    });
    expect(seen.length).toBe(r.pages);
    expect(seen[seen.length - 1]).toBeNull();
    expect(seen.slice(0, -1).every((c) => typeof c === "string")).toBe(true);
  });

  it("never re-reads the same page when a jump would not move forward", async () => {
    // Keys that are not events/<id>/<folder>/<file> resume after the last key.
    const odd = Array.from({ length: 5 }, (_, i) => orig(`events/x${i}`));
    const { deps, listCalls } = fakeBucket(odd, 2);
    const r = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    expect(r.wrapped).toBe(true);
    expect(new Set(listCalls).size).toBe(listCalls.length);
  });

  it("treats an object changed (412) or gone (404) since listing as skipped, not failed", async () => {
    const { deps } = fakeBucket(bucket, 10);
    let n = 0;
    deps.copyToIa = async () => {
      n += 1;
      throw n === 1
        ? Object.assign(new Error("precondition"), { name: "PreconditionFailed" })
        : Object.assign(new Error("gone"), { $metadata: { httpStatusCode: 404 } });
    };
    const r = await runTieringPass(deps, { startAfter: null, excluded: none, now: NOW, maxPages: 50 });
    expect(r.failed).toEqual([]);
    expect(r.counts).toMatchObject({ changed: 1, gone: 1 });
    expect(r.stalled).toBe(false);
  });
});
