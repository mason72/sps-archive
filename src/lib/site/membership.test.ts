import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./publish", () => ({
  publishAssetToLane: vi.fn(() => Promise.resolve({ streamUid: null })),
  unpublishAssetFromLane: vi.fn(() => Promise.resolve()),
}));

import { publishAssetToLane, unpublishAssetFromLane } from "./publish";
import { syncSitePublication } from "./membership";

interface ImageRow {
  id: string;
  r2_key: string;
  service: string | null;
  focal_x: number | null;
  site_published_at: string | null;
  thumbnail_generated: boolean;
  media_type: string;
  duration_seconds: number | null;
  has_audio: boolean | null;
  stream_uid: string | null;
  original_filename: string;
}

interface FaceRow {
  image_id: string;
  bbox_x: number;
  bbox_y: number;
  bbox_w: number;
  bbox_h: number;
  quality: number;
}

/**
 * Minimal fake of the reads + image update the sync performs. Captures
 * update payloads per image id for assertions.
 */
function fakeSupabase(
  links: { image_id: string; sections: { site_scene_key: string } }[],
  images: ImageRow[],
  opts: { updateError?: boolean; faces?: FaceRow[] } = {}
) {
  const updates: Record<string, Record<string, unknown>> = {};

  function thenable(result: unknown) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "in", "not"]) b[m] = vi.fn(() => b);
    b.then = (resolve: (v: unknown) => void) =>
      resolve({ data: result, error: null });
    return b;
  }

  const client = {
    from: (table: string) => {
      if (table === "section_images") return thenable(links);
      if (table === "faces") return thenable(opts.faces ?? []);
      if (table === "images") {
        const b = thenable(images) as Record<string, unknown>;
        b.update = vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((_col: string, id: string) => {
            updates[id] = payload;
            return Promise.resolve({
              error: opts.updateError ? new Error("update failed") : null,
            });
          }),
        }));
        return b;
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, updates };
}

const img = (overrides: Partial<ImageRow>): ImageRow => ({
  id: "img-1",
  r2_key: "events/e1/originals/a.jpg",
  service: null,
  focal_x: null,
  site_published_at: null,
  thumbnail_generated: true,
  media_type: "image",
  duration_seconds: null,
  has_audio: null,
  stream_uid: null,
  original_filename: "a.jpg",
  ...overrides,
});

const face = (overrides: Partial<FaceRow> = {}): FaceRow => ({
  image_id: "img-1",
  bbox_x: 0.4,
  bbox_y: 0.2,
  bbox_w: 0.2,
  bbox_h: 0.15,
  quality: 0.6,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("syncSitePublication", () => {
  it("publishes images that joined a website section and stamps site_published_at", async () => {
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "hero" } }],
      [img({})]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(publishAssetToLane).toHaveBeenCalledWith(
      expect.objectContaining({
        r2Key: "events/e1/originals/a.jpg",
        mediaType: "image",
      })
    );
    expect(updates["img-1"].site_published_at).toBeTruthy();
    // R2-lane assets never write a stream uid.
    expect(updates["img-1"].stream_uid).toBeUndefined();
    expect(result.published).toEqual(["img-1"]);
    expect(result.failed).toEqual([]);
  });

  it("auto-fills service from the scene, never overwriting a manual value", async () => {
    const { client, updates } = fakeSupabase(
      [
        { image_id: "img-1", sections: { site_scene_key: "service/video" } },
        { image_id: "img-2", sections: { site_scene_key: "service/video" } },
      ],
      [img({ id: "img-1" }), img({ id: "img-2", service: "photo-booth" })]
    );

    await syncSitePublication(client, ["img-1", "img-2"]);

    expect(updates["img-1"].service).toBe("video");
    expect(updates["img-2"].service).toBeUndefined();
  });

  it("skips images without thumbnails (published later by the upload paths)", async () => {
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "hero" } }],
      [img({ thumbnail_generated: false })]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(publishAssetToLane).not.toHaveBeenCalled();
    expect(updates["img-1"]).toBeUndefined();
    expect(result.published).toEqual([]);
  });

  it("persists the Stream UID when publishing routes a video to Stream", async () => {
    vi.mocked(publishAssetToLane).mockResolvedValueOnce({
      streamUid: "stream-abc",
    });
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "featured-work" } }],
      [
        img({
          r2_key: "events/e1/originals/reel.mp4",
          media_type: "video",
          duration_seconds: 180,
          has_audio: true,
          original_filename: "reel.mp4",
        }),
      ]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(publishAssetToLane).toHaveBeenCalledWith(
      expect.objectContaining({
        mediaType: "video",
        durationSeconds: 180,
        hasAudio: true,
        streamUid: null,
      })
    );
    expect(updates["img-1"].stream_uid).toBe("stream-abc");
    expect(updates["img-1"].site_published_at).toBeTruthy();
    expect(result.published).toEqual(["img-1"]);
  });

  it("does not rewrite an unchanged Stream UID on re-publish", async () => {
    vi.mocked(publishAssetToLane).mockResolvedValueOnce({
      streamUid: "stream-abc",
    });
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "featured-work" } }],
      [
        img({
          media_type: "video",
          duration_seconds: 180,
          has_audio: true,
          stream_uid: "stream-abc",
          site_published_at: "2026-01-01T00:00:00Z",
        }),
      ]
    );

    await syncSitePublication(client, ["img-1"]);

    expect(updates["img-1"].stream_uid).toBeUndefined();
  });

  it("clears the Stream UID when unpublishing a stream-lane video", async () => {
    const { client, updates } = fakeSupabase(
      [],
      [
        img({
          media_type: "video",
          duration_seconds: 180,
          has_audio: true,
          stream_uid: "stream-abc",
          site_published_at: "2026-01-01T00:00:00Z",
        }),
      ]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(unpublishAssetFromLane).toHaveBeenCalledWith(
      expect.objectContaining({ streamUid: "stream-abc" })
    );
    expect(updates["img-1"].site_published_at).toBeNull();
    expect(updates["img-1"].stream_uid).toBeNull();
    expect(result.unpublished).toEqual(["img-1"]);
  });

  it("unpublishes previously-published images with no remaining website membership", async () => {
    const { client, updates } = fakeSupabase(
      [],
      [img({ site_published_at: "2026-01-01T00:00:00Z" })]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(unpublishAssetFromLane).toHaveBeenCalledWith(
      expect.objectContaining({ r2Key: "events/e1/originals/a.jpg" })
    );
    expect(updates["img-1"].site_published_at).toBeNull();
    expect(result.unpublished).toEqual(["img-1"]);
  });

  it("leaves never-published, non-member images alone", async () => {
    const { client, updates } = fakeSupabase([], [img({})]);

    const result = await syncSitePublication(client, ["img-1"]);

    expect(publishAssetToLane).not.toHaveBeenCalled();
    expect(unpublishAssetFromLane).not.toHaveBeenCalled();
    expect(updates["img-1"]).toBeUndefined();
    expect(result).toEqual({ published: [], unpublished: [], failed: [] });
  });

  it("keeps the published marker when the R2 delete fails, so the next sync retries", async () => {
    vi.mocked(unpublishAssetFromLane).mockRejectedValueOnce(
      new Error("R2 down")
    );
    const { client, updates } = fakeSupabase(
      [],
      [img({ site_published_at: "2026-01-01T00:00:00Z" })]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(updates["img-1"]).toBeUndefined();
    expect(result.failed).toEqual(["img-1"]);
    expect(result.unpublished).toEqual([]);
  });

  it("reports publish failures without stamping the marker", async () => {
    vi.mocked(publishAssetToLane).mockRejectedValueOnce(new Error("R2 down"));
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "hero" } }],
      [img({})]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(updates["img-1"]).toBeUndefined();
    expect(result.failed).toEqual(["img-1"]);
  });

  it("auto-fills the focal point for a slot-scene image with one confident face", async () => {
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "slot/slice-1" } }],
      [img({})],
      { faces: [face()] }
    );

    await syncSitePublication(client, ["img-1"]);

    // Eye level: x = (0.4 + 0.2/2)*100 = 50; y = (0.2 + 0.15*0.35)*100 → 25.3
    expect(updates["img-1"].focal_x).toBe(50);
    expect(updates["img-1"].focal_y).toBe(25.3);
  });

  it("does not auto-fill focal for pool-only membership, even with a face", async () => {
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "hero" } }],
      [img({})],
      { faces: [face()] }
    );

    await syncSitePublication(client, ["img-1"]);

    expect(updates["img-1"].focal_x).toBeUndefined();
  });

  it("never overwrites an existing focal point", async () => {
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "slot/slice-1" } }],
      [img({ focal_x: 12 })],
      { faces: [face()] }
    );

    await syncSitePublication(client, ["img-1"]);

    expect(updates["img-1"].focal_x).toBeUndefined();
    expect(updates["img-1"].focal_y).toBeUndefined();
  });

  it("anchors groups at the union center (2026-08-10: groups get focals too)", async () => {
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "slot/slice-1" } }],
      [img({})],
      { faces: [face(), face({ bbox_x: 0.7 })] }
    );

    await syncSitePublication(client, ["img-1"]);

    // Two confident faces 0.4..0.6 and 0.7..0.9 → union center x = 65.
    expect(updates["img-1"].focal_x).toBe(65);
  });

  it("is a no-op for an empty id list", async () => {
    const { client } = fakeSupabase([], []);
    const result = await syncSitePublication(client, []);
    expect(result).toEqual({ published: [], unpublished: [], failed: [] });
  });
});
