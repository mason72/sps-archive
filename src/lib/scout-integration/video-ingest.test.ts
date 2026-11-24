import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Everything with I/O is faked; the store's own order and rollback are real.
const r2 = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  deleted: [] as string[],
}));
vi.mock("@/lib/r2/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2/client")>();
  return {
    ...real,
    uploadToR2: vi.fn(async (key: string, body: Buffer) => {
      r2.objects.set(key, Buffer.from(body));
      return { key, url: key };
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
vi.mock("@/lib/video/process", () => ({ processMutedVideoViaModal: vi.fn() }));
vi.mock("./fetch-image", async (importOriginal) => {
  const real = await importOriginal<typeof import("./fetch-image")>();
  return {
    ...real,
    fetchPostcardVideo: vi.fn(),
    fetchPostcardImage: vi.fn(),
    // The read-back of what the pipeline stored: served from the fake bucket.
    fetchCapped: vi.fn(async (url: URL) => {
      const key = url.pathname.slice(1);
      const b = r2.objects.get(key);
      if (!b) throw new Error(`no object ${key}`);
      return b;
    }),
  };
});
vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async () => ({ ids: [] })) } }));
vi.mock("@/lib/thumbnails/generate", () => ({ generateThumbnailsFromBuffer: vi.fn() }));
vi.mock("@/lib/site/membership", () => ({ syncSitePublication: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { processMutedVideoViaModal } from "@/lib/video/process";
import { getDisplayKey, getThumbnailKey } from "@/lib/r2/client";
import { assetLane, publicLaneKeys } from "@/lib/site/publish";
import { fetchPostcardImage, fetchPostcardVideo } from "./fetch-image";
import { FakeDb } from "./fake-db";
import { ingestPostcard, postcardDetail, scoutStagingKey, type ScoutDb } from "./store";
import type { PostcardInput } from "./validate";

const fixture = (n: string) => readFileSync(join(__dirname, "../video/__fixtures__", n));
const WITH_AUDIO = fixture("tone-with-audio.mp4");
const MUTED = fixture("tone-muted.mp4");

const OWNER = "00000000-0000-4000-8000-00000000aaaa";
const PID = "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b";

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

/** A pipeline that writes `stored` as the original and three posters. */
function pipelineWrites(stored: Buffer, extra: Record<string, unknown> = {}) {
  vi.mocked(processMutedVideoViaModal).mockImplementation(async (_src, dest) => {
    r2.objects.set(dest, stored);
    for (const v of ["thumb-sm", "thumb-md", "thumb-lg"] as const) r2.objects.set(getThumbnailKey(dest, v), Buffer.from("jpg"));
    return { ok: true, durationSeconds: 3, width: 320, height: 240, hasAudio: true, muted: true, ...extra };
  });
}

let db: FakeDb;
beforeEach(() => {
  vi.clearAllMocks();
  r2.objects.clear();
  r2.deleted.length = 0;
  db = new FakeDb();
  db.tables.events.push({ id: "website", slug: "tdp-website", user_id: OWNER });
  vi.mocked(fetchPostcardVideo).mockResolvedValue(WITH_AUDIO);
});
const store = () => db as unknown as ScoutDb;

describe("a Scout clip", () => {
  it("is filed as the SILENT copy: a video row with no audio, the clip with sound gone", async () => {
    pipelineWrites(MUTED);
    const res = await ingestPostcard(store(), input());

    expect(res).toMatchObject({ created: true, status: "ready" });
    const row = db.tables.images[0];
    expect(row).toMatchObject({ media_type: "video", mime_type: "video/mp4", has_audio: false, processing_status: "complete", thumbnail_generated: true });
    expect(row.file_size).toBe(MUTED.byteLength);

    // The pipeline read the staging copy and wrote the stored original.
    const [src, dest] = vi.mocked(processMutedVideoViaModal).mock.calls[0];
    expect(src).toBe(scoutStagingKey(row.id));
    expect(dest).toBe(row.r2_key);
    // What is stored is byte-for-byte the muted rendition, and the clip WITH
    // sound (the staging object) is gone.
    expect(r2.objects.get(row.r2_key)?.equals(MUTED)).toBe(true);
    expect(r2.objects.has(scoutStagingKey(row.id))).toBe(false);
    expect([...r2.objects.values()].some((b) => b.equals(WITH_AUDIO))).toBe(false);

    // And the stored original is exactly what the website plays: a silent
    // clip of 60 s or less publishes on the R2 video lane, whose playable file
    // is the display key, which for an .mp4 IS the original.
    expect(assetLane({ mediaType: "video", durationSeconds: 3, hasAudio: false })).toBe("video");
    expect(getDisplayKey(row.r2_key)).toBe(row.r2_key);
    expect(publicLaneKeys(row.r2_key).displayKey).toBe(row.r2_key);
  });

  it("is refused, and nothing kept, when the stored copy still has an audio track", async () => {
    // A pipeline that CLAIMS muted but wrote the clip with its sound.
    pipelineWrites(WITH_AUDIO);
    await expect(ingestPostcard(store(), input())).rejects.toMatchObject({ status: 502 });
    expect(db.tables.images).toHaveLength(0);
    expect(db.tables.scout_postcard_links).toHaveLength(0);
    expect(r2.objects.size).toBe(0); // original, posters and staging all removed
  });

  it("is refused when the pipeline does not confirm muting (an old deployment)", async () => {
    vi.mocked(processMutedVideoViaModal).mockRejectedValue(new Error("Video pipeline did not confirm a muted rendition"));
    await expect(ingestPostcard(store(), input())).rejects.toThrow(/muted/);
    expect(db.tables.images).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("is refused past Scout's length cap, by the pipeline's own probe", async () => {
    pipelineWrites(MUTED, { durationSeconds: 75 });
    await expect(ingestPostcard(store(), input())).rejects.toMatchObject({ status: 400 });
    expect(db.tables.images).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("is idempotent: a repeat returns the same link and fetches nothing", async () => {
    pipelineWrites(MUTED);
    const first = await ingestPostcard(store(), input());
    vi.clearAllMocks();
    const again = await ingestPostcard(store(), input({ videoUrl: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/fresh.mp4" }));
    expect(again).toMatchObject({ created: false, status: "ready" });
    expect(again.link.image_id).toBe(first.link.image_id);
    expect(fetchPostcardVideo).not.toHaveBeenCalled();
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
    expect(db.tables.images).toHaveLength(1);
  });

  it("rolls back the row and every object when the section link fails", async () => {
    pipelineWrites(MUTED);
    db.failNext = { op: "insert", table: "section_images", error: { message: "boom" } };
    await expect(ingestPostcard(store(), input())).rejects.toMatchObject({ message: "boom" });
    expect(db.tables.images).toHaveLength(0);
    expect(db.tables.scout_postcard_links).toHaveLength(0);
    expect(r2.objects.size).toBe(0);
  });

  it("reads back as a ready video with no crew (clips have no detected faces)", async () => {
    pipelineWrites(MUTED);
    await ingestPostcard(store(), input());
    const detail = await postcardDetail(store(), PID);
    expect(detail).toMatchObject({ status: "ready", media_type: "video", crew: [] });
  });
});

describe("a Scout photo", () => {
  it("still goes down the photo path untouched", async () => {
    vi.mocked(fetchPostcardImage).mockRejectedValue(new Error("photo path taken"));
    await expect(ingestPostcard(store(), input({ mediaType: "photo", videoUrl: null, durationS: null }))).rejects.toThrow(
      "photo path taken"
    );
    expect(fetchPostcardVideo).not.toHaveBeenCalled();
    expect(processMutedVideoViaModal).not.toHaveBeenCalled();
  });
});
