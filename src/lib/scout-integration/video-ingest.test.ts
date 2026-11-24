import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Everything with I/O is faked; the store's own order and rollback are real.
const r2 = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  deleted: [] as string[],
  copies: [] as [string, string][],
  /** Replace the staged object right after it is read (a swap between check and copy). */
  swapAfterRead: null as Buffer | null,
  /** Make the copy land different bytes than its source (a bad copy). */
  corruptCopy: false,
}));
/** A content fingerprint standing in for R2's ETag (FNV-1a over the bytes). */
const md5 = vi.hoisted(() => (b: Buffer) => {
  let h = 0x811c9dc5;
  for (const x of b) h = Math.imul(h ^ x, 0x01000193) >>> 0;
  return `${h.toString(16)}-${b.byteLength}`;
});
vi.mock("@/lib/r2/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2/client")>();
  return {
    ...real,
    uploadToR2: vi.fn(async (key: string, body: Buffer) => {
      r2.objects.set(key, Buffer.from(body));
      return { key, url: key };
    }),
    copyWithinR2: vi.fn(async (src: string, dest: string, _ct: string, _t: number, opts?: { ifMatch?: string }) => {
      const b = r2.objects.get(src);
      if (!b) throw new Error(`no object ${src}`);
      if (opts?.ifMatch && opts.ifMatch !== md5(b)) {
        throw Object.assign(new Error("PreconditionFailed"), { name: "PreconditionFailed" });
      }
      r2.copies.push([src, dest]);
      r2.objects.set(dest, r2.corruptCopy ? Buffer.concat([b, Buffer.from("x")]) : b);
    }),
    headR2Object: vi.fn(async (key: string) => {
      const b = r2.objects.get(key);
      if (!b) throw new Error(`no object ${key}`);
      return { etag: md5(b), size: b.byteLength };
    }),
    deleteFromR2: vi.fn(async (key: string) => {
      r2.deleted.push(key);
      r2.objects.delete(key);
    }),
    deleteImageAssets: vi.fn(async (key: string) => {
      for (const k of [key, real.getThumbnailKey(key, "thumb-sm"), real.getThumbnailKey(key, "thumb-md"), real.getThumbnailKey(key, "thumb-lg")]) {
        r2.deleted.push(k);
        r2.objects.delete(k);
      }
      return [];
    }),
    getPresignedDownloadUrl: vi.fn(async (key: string) => `https://r2.test/${key}`),
  };
});
vi.mock("@/lib/video/process", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/video/process")>();
  return {
    ...real,
    processMutedVideoViaModal: vi.fn(),
    isVideoMuteConfigured: vi.fn(() => true),
  };
});
vi.mock("./fetch-image", async (importOriginal) => {
  const real = await importOriginal<typeof import("./fetch-image")>();
  return {
    ...real,
    fetchPostcardVideo: vi.fn(),
    fetchPostcardImage: vi.fn(),
    // The read-back of what the pipeline stored: served from the fake bucket,
    // with the object's ETag as R2 sends it (quoted).
    fetchCappedWithEtag: vi.fn(async (url: URL) => {
      const key = url.pathname.slice(1);
      const b = r2.objects.get(key);
      if (!b) throw new Error(`no object ${key}`);
      if (r2.swapAfterRead) r2.objects.set(key, r2.swapAfterRead);
      return { buf: b, etag: `"${md5(b)}"` };
    }),
  };
});
vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async () => ({ ids: [] })) } }));
vi.mock("@/lib/thumbnails/generate", () => ({ generateThumbnailsFromBuffer: vi.fn() }));
vi.mock("@/lib/site/membership", () => ({ syncSitePublication: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import {
  VideoMuteUnavailableError,
  isVideoMuteConfigured,
  mutePutTtlSeconds,
  processMutedVideoViaModal,
} from "@/lib/video/process";
import { copyWithinR2, getDisplayKey, getThumbnailKey, uploadToR2 } from "@/lib/r2/client";
import { inngest } from "@/lib/inngest/client";
import { assetLane, publicLaneKeys } from "@/lib/site/publish";
import { PostcardFetchError, fetchPostcardImage, fetchPostcardVideo } from "./fetch-image";
import { FakeDb } from "./fake-db";
import {
  AFTER_PIPELINE_RESERVE_MS,
  MIN_REMAINING_FOR_PIPELINE_MS,
  CLEANUP_SEND_TIMEOUT_MS,
  ROLLBACK_RESERVE_MS,
  VIDEO_REQUEST_BUDGET_MS,
  ingestPostcard,
  pipelineTimeoutMs,
  postcardDetail,
  type ScoutDb,
} from "./store";
import type { PostcardInput } from "./validate";

const fixture = (n: string) => readFileSync(join(__dirname, "../video/__fixtures__", n));
const WITH_AUDIO = fixture("tone-with-audio.mp4");
const MUTED = fixture("tone-muted.mp4");
const FRAGMENTED = fixture("tone-muted-fragmented.mp4");

const OWNER = "00000000-0000-4000-8000-00000000aaaa";
const PID = "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b";

/** A copy of an MP4 whose movie header says `duration / timescale` seconds (version-0 mvhd). */
function withMovieLength(mp4: Buffer, timescale: number, duration: number): Buffer {
  const out = Buffer.from(mp4);
  const at = out.indexOf("mvhd");
  if (at < 0 || out[at + 4] !== 0) throw new Error("fixture has no version-0 mvhd");
  out.writeUInt32BE(timescale, at + 4 + 12);
  out.writeUInt32BE(duration, at + 4 + 16);
  return out;
}

/** A copy of an MP4 whose video sample entry is renamed (e.g. avc1 → hvc1). */
function withSampleEntry(mp4: Buffer, fourcc: string): Buffer {
  const out = Buffer.from(mp4);
  // The sample entry, not the "avc1" compatible brand in ftyp.
  const at = out.indexOf("avc1", out.indexOf("stsd"));
  if (out.indexOf("stsd") < 0 || at < 0) throw new Error("fixture has no avc1 sample entry");
  out.write(fourcc, at, "latin1");
  return out;
}

const input = (over: Partial<PostcardInput> = {}): PostcardInput => ({
  postcardId: PID,
  gigId: "gig-1",
  gigTitle: "Acme SKO",
  gigStart: "2026-11-20",
  takenAt: null,
  authorEmail: "joey@twodudesphoto.com",
  imageUrl: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/poster.jpg",
  width: null,
  height: null,
  mediaType: "video",
  videoUrl: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/clip.mp4",
  durationS: 3,
  ...over,
});

/** A pipeline that stages `staged` and writes three posters, then answers. */
function pipelineWrites(staged: Buffer, extra: Record<string, unknown> = {}) {
  vi.mocked(processMutedVideoViaModal).mockImplementation(async (_src, keys) => {
    r2.objects.set(keys.stagedKey, staged);
    for (const v of ["thumb-sm", "thumb-md", "thumb-lg"] as const) r2.objects.set(getThumbnailKey(keys.posterKey, v), Buffer.from("jpg"));
    return { ok: true, durationSeconds: 3, width: 320, height: 240, hasAudio: true, muted: true, ...extra };
  });
}

let db: FakeDb;
const dbUntil = vi.fn<(deadlineAt: number) => ScoutDb>(() => db as unknown as ScoutDb);
const freshDb = () => {
  db = new FakeDb();
  db.tables.events.push({ id: "website", slug: "tdp-website", user_id: OWNER });
};
beforeEach(() => {
  vi.clearAllMocks();
  r2.objects.clear();
  r2.deleted.length = 0;
  r2.copies.length = 0;
  r2.swapAfterRead = null;
  r2.corruptCopy = false;
  freshDb();
  vi.mocked(fetchPostcardVideo).mockResolvedValue(WITH_AUDIO);
  vi.mocked(isVideoMuteConfigured).mockReturnValue(true);
});
const store = () => db as unknown as ScoutDb;
const ingest = (over: Partial<PostcardInput> = {}, startedAt?: number) =>
  ingestPostcard(store(), input(over), { dbUntil, ...(startedAt ? { startedAt } : {}) });
const keysUnder = (part: string) => [...r2.objects.keys()].filter((k) => k.includes(part));

/** Nothing at all was written: no gallery, no section, no row, no object. */
function expectNoWrites() {
  expect(db.tables.events.map((e) => e.slug)).toEqual(["tdp-website"]);
  expect(db.tables.sections).toHaveLength(0);
  expect(db.tables.images).toHaveLength(0);
  expect(r2.objects.size).toBe(0);
}

describe("a Scout clip", () => {
  it("is filed as the SILENT copy, verified while STAGED and only then moved into originals", async () => {
    pipelineWrites(MUTED);
    const res = await ingest();

    expect(res).toMatchObject({ created: true, status: "ready" });
    const row = db.tables.images[0];
    expect(row).toMatchObject({ media_type: "video", mime_type: "video/mp4", has_audio: false, processing_status: "complete", thumbnail_generated: true });
    expect(row.file_size).toBe(MUTED.byteLength);

    // Modal got Scout's own URL and a STAGING key; the posters belong to the original.
    const [src, keys] = vi.mocked(processMutedVideoViaModal).mock.calls[0];
    expect(src).toEqual({ url: input().videoUrl });
    expect(keys.stagedKey).toMatch(/^scout-staging\/[^/]+\/[^/]+\.mp4$/);
    expect(keys.posterKey).toBe(row.r2_key);
    // Copied into originals only after the checks; the staged (silent) copy is
    // left for the cleanup job, which was scheduled BEFORE Modal was called.
    expect(r2.copies).toEqual([[keys.stagedKey, row.r2_key]]);
    expect(r2.objects.get(row.r2_key)?.equals(MUTED)).toBe(true);
    expect(keysUnder("scout-staging/")).toEqual([keys.stagedKey]);
    expect(r2.objects.get(keys.stagedKey)?.equals(MUTED)).toBe(true);
    // The clip with sound was never written to our storage at all.
    expect(uploadToR2).not.toHaveBeenCalled();
    expect([...r2.objects.values()].some((b) => b.equals(WITH_AUDIO))).toBe(false);
    const send = vi.mocked(inngest.send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ name: "scout/clip.cleanup", data: { imageId: row.id } });
    expect(send.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(processMutedVideoViaModal).mock.invocationCallOrder[0]
    );

    // What the website plays is that original: a silent clip on the R2 lane.
    expect(assetLane({ mediaType: "video", durationSeconds: 3, hasAudio: false })).toBe("video");
    expect(getDisplayKey(row.r2_key)).toBe(row.r2_key);
    expect(publicLaneKeys(row.r2_key).displayKey).toBe(row.r2_key);
  });

  it("never lets a copy with sound reach originals/, with the late-PUT cleanup already scheduled", async () => {
    pipelineWrites(WITH_AUDIO); // a pipeline that CLAIMS muted but staged sound
    await expect(ingest()).rejects.toMatchObject({ status: 502 });
    expect(copyWithinR2).not.toHaveBeenCalled();
    expect(db.tables.images).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
    const sent = vi.mocked(inngest.send).mock.calls[0][0] as { name: string; data: { sleepSeconds: number } };
    expect(sent.name).toBe("scout/clip.cleanup");
    const ttl = mutePutTtlSeconds(pipelineTimeoutMs(0, 0)!);
    expect(sent.data.sleepSeconds).toBeGreaterThan(ttl - 30); // past the upload URLs' life
  });

  it("refuses a staged copy that is fragmented, even with no audio track", async () => {
    pipelineWrites(FRAGMENTED);
    await expect(ingest()).rejects.toMatchObject({ status: 502 });
    expect(copyWithinR2).not.toHaveBeenCalled();
    expect(r2.objects.size).toBe(0);
  });

  it("answers a retryable 503, writing nothing, when the mute endpoint is not configured", async () => {
    vi.mocked(isVideoMuteConfigured).mockReturnValue(false);
    await expect(ingest()).rejects.toMatchObject({ status: 503 });
    expect(fetchPostcardVideo).not.toHaveBeenCalled();
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("answers a retryable 503 when the deployed pipeline has no mute endpoint (404): no row, no clip object", async () => {
    vi.mocked(processMutedVideoViaModal).mockRejectedValue(new VideoMuteUnavailableError("no mute_video endpoint (404)"));
    await expect(ingest()).rejects.toMatchObject({ status: 503 });
    // The gallery and gig section were ensured before the call; they are reused.
    expect(db.tables.images).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("does not call Modal when the cleanup cannot be scheduled: 503, no row, no clip object", async () => {
    pipelineWrites(MUTED);
    vi.mocked(inngest.send).mockRejectedValueOnce(new Error("inngest down"));
    await expect(ingest()).rejects.toMatchObject({ status: 503 });
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expect(db.tables.images).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("gives up on a cleanup schedule that hangs, within its timeout, without calling Modal", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      pipelineWrites(MUTED);
      vi.mocked(inngest.send).mockImplementationOnce(() => new Promise(() => {}));
      const run = ingest().then(() => null, (e) => e);
      await vi.advanceTimersByTimeAsync(CLEANUP_SEND_TIMEOUT_MS + 10);
      expect(await run).toMatchObject({ status: 503 });
      expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-checks the budget after the gallery and section are ensured, before any upload URL or Modal call", async () => {
    pipelineWrites(MUTED);
    const base = Date.now();
    let late = false;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => (late ? base + VIDEO_REQUEST_BUDGET_MS : base));
    const realFrom = db.from.bind(db);
    db.from = ((t: string) => {
      if (t === "sections") late = true; // the ensures "took" the whole budget
      return realFrom(t);
    }) as typeof db.from;
    try {
      await expect(ingest({}, base)).rejects.toMatchObject({ status: 503 });
    } finally {
      nowSpy.mockRestore();
    }
    expect(inngest.send).not.toHaveBeenCalled();
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expect(db.tables.images).toHaveLength(0);
  });

  it("copies EXACTLY the checked bytes: a staged object swapped after the check is never filed", async () => {
    pipelineWrites(MUTED);
    r2.swapAfterRead = WITH_AUDIO; // replaced between our read and the copy
    await expect(ingest()).rejects.toMatchObject({ status: 502 });
    expect(r2.copies).toEqual([]);
    expect(db.tables.images).toHaveLength(0);
    expect(keysUnder("/originals/")).toEqual([]);
  });

  it("answers 502 (not Scout's 413) when OUR staged copy reads back over the cap", async () => {
    pipelineWrites(MUTED);
    const { fetchCappedWithEtag } = await import("./fetch-image");
    vi.mocked(fetchCappedWithEtag).mockRejectedValueOnce(new PostcardFetchError("the silent copy is over the limit", 413));
    await expect(ingest()).rejects.toMatchObject({ status: 502 });
    expect(db.tables.images).toHaveLength(0);
    expect(keysUnder("/originals/")).toEqual([]);
  });

  it("refuses a filed copy whose ETag or size is not the checked one", async () => {
    pipelineWrites(MUTED);
    r2.corruptCopy = true;
    await expect(ingest()).rejects.toMatchObject({ status: 502 });
    expect(db.tables.images).toHaveLength(0);
    expect(keysUnder("/originals/")).toEqual([]);
  });

  it("refuses an HEVC or overlong clip on the first read: no gallery, no section, no Modal call", async () => {
    vi.mocked(fetchPostcardVideo).mockRejectedValue(new PostcardFetchError("video_url is not H.264 (hvc1)", 415));
    await expect(ingest()).rejects.toMatchObject({ status: 415 });
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("refuses with a retryable 503 before ANY write when the budget is nearly spent", async () => {
    pipelineWrites(MUTED);
    const startedAt = Date.now() - (VIDEO_REQUEST_BUDGET_MS - MIN_REMAINING_FOR_PIPELINE_MS + 1_000);
    await expect(ingest({}, startedAt)).rejects.toMatchObject({ status: 503 });
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("judges length by the STAGED file, whatever the pipeline reported", async () => {
    pipelineWrites(withMovieLength(MUTED, 1000, 75_000), { durationSeconds: 3 });
    await expect(ingest()).rejects.toMatchObject({ status: 400 });
    expect(db.tables.images).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("accepts up to exactly 61 s and refuses anything longer, with no slack (the R2 lane's limit)", async () => {
    pipelineWrites(withMovieLength(MUTED, 1000, 60_500), { durationSeconds: 3 });
    await ingest();
    expect(db.tables.images[0].duration_seconds).toBe(60.5); // the stored length is what is filed
    expect(assetLane({ mediaType: "video", durationSeconds: 60.5, hasAudio: false })).toBe("video");

    for (const ms of [61_000, 61_010]) {
      freshDb();
      r2.objects.clear();
      pipelineWrites(withMovieLength(MUTED, 1000, ms));
      const run = ingest();
      if (ms === 61_000) await expect(run).resolves.toMatchObject({ created: true });
      else await expect(run).rejects.toMatchObject({ status: 400 });
    }
  });

  it("refuses a staged copy that is not H.264", async () => {
    pipelineWrites(withSampleEntry(MUTED, "hvc1"));
    await expect(ingest()).rejects.toMatchObject({ status: 415 });
    expect(r2.objects.size).toBe(0);
  });

  it("refuses a staged copy whose length cannot be read", async () => {
    pipelineWrites(withMovieLength(MUTED, 0, 0));
    await expect(ingest()).rejects.toMatchObject({ status: 502 });
    expect(r2.objects.size).toBe(0);
  });

  it("runs the post-pipeline writes on a client that stops before the budget ends", async () => {
    pipelineWrites(MUTED);
    const startedAt = Date.now();
    await ingest({}, startedAt);
    expect(dbUntil).toHaveBeenCalledWith(startedAt + VIDEO_REQUEST_BUDGET_MS - ROLLBACK_RESERVE_MS);
  });

  it("is idempotent: a repeat returns the same link and fetches nothing", async () => {
    pipelineWrites(MUTED);
    const first = await ingest();
    vi.clearAllMocks();
    const again = await ingest({ videoUrl: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/fresh.mp4" });
    expect(again).toMatchObject({ created: false, status: "ready" });
    expect(again.link.image_id).toBe(first.link.image_id);
    expect(fetchPostcardVideo).not.toHaveBeenCalled();
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expect(db.tables.images).toHaveLength(1);
  });

  it("rolls back the row and every object when the section link fails", async () => {
    pipelineWrites(MUTED);
    db.failNext = { op: "insert", table: "section_images", error: { message: "boom" } };
    await expect(ingest()).rejects.toMatchObject({ message: "boom" });
    expect(db.tables.images).toHaveLength(0);
    expect(db.tables.scout_postcard_links).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("loses a claim race cleanly: its own copy goes, the winner's link comes back", async () => {
    pipelineWrites(MUTED);
    const winner = { postcard_id: PID, image_id: "winner-image", event_id: "e", section_id: null, gig_id: "gig-1", author_email: null, created_at: "", published_target: null, published_at: null };
    db.tables.images.push({ id: "winner-image", processing_status: "complete", media_type: "video", thumbnail_generated: true });
    // The winner's link appears between our check and our claim.
    const realFrom = db.from.bind(db);
    let checks = 0;
    db.from = ((t: string) => {
      if (t === "scout_postcard_links" && ++checks === 2) db.tables.scout_postcard_links.push(winner);
      return realFrom(t);
    }) as typeof db.from;
    const res = await ingest();
    expect(res).toMatchObject({ created: false });
    expect(res.link.image_id).toBe("winner-image");
    expect(db.tables.images.map((r) => r.id)).toEqual(["winner-image"]);
    expect(r2.objects.size).toBe(0);
  });

  it("reads back as a ready video with no crew (clips have no detected faces)", async () => {
    pipelineWrites(MUTED);
    await ingest();
    const detail = await postcardDetail(store(), PID);
    expect(detail).toMatchObject({ status: "ready", media_type: "video", crew: [] });
  });
});

describe("a Scout photo", () => {
  it("still goes down the photo path untouched", async () => {
    vi.mocked(fetchPostcardImage).mockRejectedValue(new Error("photo path taken"));
    await expect(ingest({ mediaType: "photo", videoUrl: null, durationS: null })).rejects.toThrow("photo path taken");
    expect(fetchPostcardVideo).not.toHaveBeenCalled();
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
  });
});

describe("pipelineTimeoutMs", () => {
  it("never lets the pipeline plus the work after it run past the budget, which is inside the route's 300 s", () => {
    expect(VIDEO_REQUEST_BUDGET_MS).toBeLessThanOrEqual(300_000);
    for (let elapsed = 0; elapsed <= 300_000; elapsed += 500) {
      const t = pipelineTimeoutMs(0, elapsed);
      if (t == null) continue;
      expect(elapsed + t + AFTER_PIPELINE_RESERVE_MS).toBeLessThanOrEqual(VIDEO_REQUEST_BUDGET_MS);
      expect(t).toBeGreaterThanOrEqual(MIN_REMAINING_FOR_PIPELINE_MS - AFTER_PIPELINE_RESERVE_MS);
    }
  });

  it("gives the whole budget to an early start and refuses a late one (no floor)", () => {
    expect(pipelineTimeoutMs(0, 0)).toBe(VIDEO_REQUEST_BUDGET_MS - AFTER_PIPELINE_RESERVE_MS);
    expect(pipelineTimeoutMs(0, 60_000)).toBe(VIDEO_REQUEST_BUDGET_MS - 60_000 - AFTER_PIPELINE_RESERVE_MS);
    expect(pipelineTimeoutMs(0, VIDEO_REQUEST_BUDGET_MS - MIN_REMAINING_FOR_PIPELINE_MS + 1)).toBeNull();
    expect(pipelineTimeoutMs(0, 280_000)).toBeNull();
  });

  it("keeps the rollback reserve inside the 60 s kept after the pipeline", () => {
    expect(ROLLBACK_RESERVE_MS).toBeLessThan(AFTER_PIPELINE_RESERVE_MS);
  });
});
