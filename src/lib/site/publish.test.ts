import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicLaneKeys, assetLane } from "./publish";
import { getPublicLaneUrl } from "@/lib/r2/public-lane";

describe("publicLaneKeys", () => {
  it("maps a web-viewable original to thumb-md + full original", () => {
    const { thumbKey, displayKey } = publicLaneKeys(
      "events/evt1/originals/photo.jpg"
    );
    expect(thumbKey).toBe("events/evt1/thumbnails/thumb-md/photo.jpg");
    // JPEG is web-viewable → full URL is the original itself.
    expect(displayKey).toBe("events/evt1/originals/photo.jpg");
  });

  it("falls back to thumb-lg as the display variant for non-web formats (TIFF)", () => {
    const { thumbKey, displayKey } = publicLaneKeys(
      "events/evt1/originals/scan.tiff"
    );
    expect(thumbKey).toBe("events/evt1/thumbnails/thumb-md/scan.jpg");
    expect(displayKey).toBe("events/evt1/thumbnails/thumb-lg/scan.jpg");
  });

  it("passes an mp4 original through as its own display key (poster thumb beside it)", () => {
    const { thumbKey, displayKey } = publicLaneKeys(
      "events/evt1/originals/clip.mp4"
    );
    expect(thumbKey).toBe("events/evt1/thumbnails/thumb-md/clip.jpg");
    expect(displayKey).toBe("events/evt1/originals/clip.mp4");
  });

  it("maps a .mov original to its remuxed mp4 rendition (Firefox can't play QuickTime)", () => {
    const { thumbKey, displayKey } = publicLaneKeys(
      "events/evt1/originals/clip.mov"
    );
    expect(thumbKey).toBe("events/evt1/thumbnails/thumb-md/clip.jpg");
    expect(displayKey).toBe("events/evt1/video/clip.mp4");
  });
});

describe("assetLane", () => {
  it("routes images to the image lane regardless of other fields", () => {
    expect(
      assetLane({ mediaType: "image", durationSeconds: null, hasAudio: null })
    ).toBe("image");
  });

  it("routes short muted clips to the R2 video lane", () => {
    expect(
      assetLane({ mediaType: "video", durationSeconds: 12, hasAudio: false })
    ).toBe("video");
    expect(
      assetLane({ mediaType: "video", durationSeconds: 60, hasAudio: false })
    ).toBe("video");
  });

  it("routes long videos to Stream", () => {
    expect(
      assetLane({ mediaType: "video", durationSeconds: 180, hasAudio: false })
    ).toBe("stream");
  });

  it("routes sound-on videos to Stream even when short", () => {
    expect(
      assetLane({ mediaType: "video", durationSeconds: 20, hasAudio: true })
    ).toBe("stream");
  });
});

describe("getPublicLaneUrl", () => {
  const original = process.env.R2_PUBLIC_LANE_URL;
  beforeEach(() => {
    process.env.R2_PUBLIC_LANE_URL = "https://cdn.pixeltrunk.com";
  });
  afterEach(() => {
    process.env.R2_PUBLIC_LANE_URL = original;
  });

  it("joins the public base with the key", () => {
    expect(getPublicLaneUrl("events/e/thumbnails/thumb-md/x.jpg")).toBe(
      "https://cdn.pixeltrunk.com/events/e/thumbnails/thumb-md/x.jpg"
    );
  });

  it("tolerates a trailing slash on the base URL", () => {
    process.env.R2_PUBLIC_LANE_URL = "https://cdn.pixeltrunk.com/";
    expect(getPublicLaneUrl("a/b.jpg")).toBe("https://cdn.pixeltrunk.com/a/b.jpg");
  });
});
