import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./publish", () => ({
  publishImageToLane: vi.fn(() => Promise.resolve()),
  unpublishImageFromLane: vi.fn(() => Promise.resolve()),
}));

import { publishImageToLane, unpublishImageFromLane } from "./publish";
import { syncSitePublication } from "./membership";

interface ImageRow {
  id: string;
  r2_key: string;
  service: string | null;
  site_published_at: string | null;
  thumbnail_generated: boolean;
}

/**
 * Minimal fake of the two reads + image update the sync performs. Captures
 * update payloads per image id for assertions.
 */
function fakeSupabase(
  links: { image_id: string; sections: { site_scene_key: string } }[],
  images: ImageRow[],
  opts: { updateError?: boolean } = {}
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
  site_published_at: null,
  thumbnail_generated: true,
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

    expect(publishImageToLane).toHaveBeenCalledWith("events/e1/originals/a.jpg");
    expect(updates["img-1"].site_published_at).toBeTruthy();
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

    expect(publishImageToLane).not.toHaveBeenCalled();
    expect(updates["img-1"]).toBeUndefined();
    expect(result.published).toEqual([]);
  });

  it("unpublishes previously-published images with no remaining website membership", async () => {
    const { client, updates } = fakeSupabase(
      [],
      [img({ site_published_at: "2026-01-01T00:00:00Z" })]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(unpublishImageFromLane).toHaveBeenCalledWith(
      "events/e1/originals/a.jpg"
    );
    expect(updates["img-1"].site_published_at).toBeNull();
    expect(result.unpublished).toEqual(["img-1"]);
  });

  it("leaves never-published, non-member images alone", async () => {
    const { client, updates } = fakeSupabase([], [img({})]);

    const result = await syncSitePublication(client, ["img-1"]);

    expect(publishImageToLane).not.toHaveBeenCalled();
    expect(unpublishImageFromLane).not.toHaveBeenCalled();
    expect(updates["img-1"]).toBeUndefined();
    expect(result).toEqual({ published: [], unpublished: [], failed: [] });
  });

  it("keeps the published marker when the R2 delete fails, so the next sync retries", async () => {
    vi.mocked(unpublishImageFromLane).mockRejectedValueOnce(
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
    vi.mocked(publishImageToLane).mockRejectedValueOnce(new Error("R2 down"));
    const { client, updates } = fakeSupabase(
      [{ image_id: "img-1", sections: { site_scene_key: "hero" } }],
      [img({})]
    );

    const result = await syncSitePublication(client, ["img-1"]);

    expect(updates["img-1"]).toBeUndefined();
    expect(result.failed).toEqual(["img-1"]);
  });

  it("is a no-op for an empty id list", async () => {
    const { client } = fakeSupabase([], []);
    const result = await syncSitePublication(client, []);
    expect(result).toEqual({ published: [], unpublished: [], failed: [] });
  });
});
