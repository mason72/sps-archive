import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  mediaTypeForMime,
  formatDuration,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
} from "./media";

describe("validateUploadFile", () => {
  it("accepts images within the 100 MB cap", () => {
    expect(
      validateUploadFile({ name: "a.jpg", type: "image/jpeg", size: 5_000_000 })
    ).toBeNull();
    expect(
      validateUploadFile({
        name: "a.heic",
        type: "image/heic",
        size: IMAGE_MAX_BYTES,
      })
    ).toBeNull();
  });

  it("rejects oversized images with a clear message", () => {
    expect(
      validateUploadFile({
        name: "huge.tif",
        type: "image/tiff",
        size: IMAGE_MAX_BYTES + 1,
      })
    ).toMatch(/100 MB/);
  });

  it("accepts mp4 and mov up to 500 MB", () => {
    expect(
      validateUploadFile({
        name: "loop.mp4",
        type: "video/mp4",
        size: VIDEO_MAX_BYTES,
      })
    ).toBeNull();
    expect(
      validateUploadFile({
        name: "reel.mov",
        type: "video/quicktime",
        size: 200_000_000,
      })
    ).toBeNull();
  });

  it("rejects oversized videos and unsupported containers politely", () => {
    expect(
      validateUploadFile({
        name: "epic.mp4",
        type: "video/mp4",
        size: VIDEO_MAX_BYTES + 1,
      })
    ).toMatch(/500 MB/);
    expect(
      validateUploadFile({
        name: "clip.webm",
        type: "video/webm",
        size: 1_000,
      })
    ).toMatch(/MP4 and QuickTime/);
  });

  it("rejects non-media formats", () => {
    expect(
      validateUploadFile({ name: "doc.pdf", type: "application/pdf", size: 10 })
    ).toMatch(/unsupported/i);
  });
});

describe("mediaTypeForMime", () => {
  it("classifies by mime prefix", () => {
    expect(mediaTypeForMime("video/mp4")).toBe("video");
    expect(mediaTypeForMime("video/quicktime")).toBe("video");
    expect(mediaTypeForMime("image/jpeg")).toBe("image");
  });
});

describe("formatDuration", () => {
  it("formats m:ss", () => {
    expect(formatDuration(7.2)).toBe("0:07");
    expect(formatDuration(73.4)).toBe("1:13");
    expect(formatDuration(3601)).toBe("60:01");
  });
});
