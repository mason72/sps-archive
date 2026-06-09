import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { publicLaneKeys } from "./publish";
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
