import { describe, it, expect } from "vitest";
import { buildImageKey, getThumbnailKey } from "./client";

describe("buildImageKey", () => {
  it("builds the originals key by default", () => {
    expect(buildImageKey("evt1", "photo.jpg")).toBe(
      "events/evt1/originals/photo.jpg"
    );
  });

  it("builds a variant thumbnail key", () => {
    expect(buildImageKey("evt1", "photo.jpg", "thumb-md")).toBe(
      "events/evt1/thumbnails/thumb-md/photo.jpg"
    );
  });
});

describe("getThumbnailKey", () => {
  it("maps an originals key to the thumb-md key with a .jpg extension", () => {
    expect(getThumbnailKey("events/evt1/originals/photo.png")).toBe(
      "events/evt1/thumbnails/thumb-md/photo.jpg"
    );
  });

  it("honours the requested variant", () => {
    expect(getThumbnailKey("events/evt1/originals/photo.jpg", "thumb-sm")).toBe(
      "events/evt1/thumbnails/thumb-sm/photo.jpg"
    );
  });

  it("swaps any original extension to .jpg", () => {
    expect(getThumbnailKey("events/e/originals/x.HEIC")).toBe(
      "events/e/thumbnails/thumb-md/x.jpg"
    );
    expect(getThumbnailKey("events/e/originals/x.tiff")).toBe(
      "events/e/thumbnails/thumb-md/x.jpg"
    );
  });

  it("returns the key unchanged when it is not an originals path", () => {
    // Already a thumbnail, or an unexpected shape → passthrough (the grid's
    // onError fallback handles a missing thumbnail).
    const thumb = "events/e/thumbnails/thumb-md/x.jpg";
    expect(getThumbnailKey(thumb)).toBe(thumb);
    expect(getThumbnailKey("random-key")).toBe("random-key");
  });

  it("handles filenames containing dots", () => {
    expect(getThumbnailKey("events/e/originals/my.photo.v2.png")).toBe(
      "events/e/thumbnails/thumb-md/my.photo.v2.jpg"
    );
  });
});
