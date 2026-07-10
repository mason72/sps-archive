import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  mediaTypeForMime,
  formatDuration,
  mediaExtension,
  stripMediaExtension,
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
        name: "a.tif",
        type: "image/tiff",
        size: IMAGE_MAX_BYTES,
      })
    ).toBeNull();
  });

  it("rejects HEIC with a convert-to-JPEG message (by mime AND extension)", () => {
    expect(
      validateUploadFile({ name: "a.heic", type: "image/heic", size: 1_000_000 })
    ).toMatch(/HEIC.*JPEG/i);
    // Browsers often report an empty MIME for .heic — match on extension too.
    expect(
      validateUploadFile({ name: "IMG_1234.HEIC", type: "", size: 1_000_000 })
    ).toMatch(/HEIC.*JPEG/i);
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

describe("mediaExtension / stripMediaExtension", () => {
  it("reads the extension from a storage filename (case-insensitive)", () => {
    expect(mediaExtension("3333edbe-uuid.jpg")).toBe("jpg");
    expect(mediaExtension("clip.MOV")).toBe("mov");
    expect(mediaExtension("scan.TIFF")).toBe("tiff");
  });

  it("returns null when there's no recognized extension", () => {
    expect(mediaExtension("Headshot")).toBeNull();
    expect(mediaExtension("Smith Jr.")).toBeNull();
    expect(mediaExtension("report.pdf")).toBeNull();
  });

  it("strips only a recognized trailing extension", () => {
    expect(stripMediaExtension("027.jpg")).toBe("027");
    expect(stripMediaExtension("01.jpg")).toBe("01");
    expect(stripMediaExtension("Headshot")).toBe("Headshot");
    expect(stripMediaExtension("Smith Jr.")).toBe("Smith Jr.");
  });

  it("is idempotent enough that retyping the extension can't double it", () => {
    // The rename path: strip what the user typed, re-append the real one.
    const ext = mediaExtension("uuid.jpg"); // "jpg"
    const typed = "01.jpg"; // user included it anyway
    expect(`${stripMediaExtension(typed)}.${ext}`).toBe("01.jpg");
  });
});
