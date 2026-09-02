import { describe, it, expect } from "vitest";
import {
  validateUploadFile,
  uploadRejectionReason,
  mediaTypeForMime,
  formatDuration,
  mediaExtension,
  stripMediaExtension,
  IMAGE_MAX_BYTES,
  VIDEO_MAX_BYTES,
  extensionForMime,
} from "./media";

/**
 * The bare reason, for the upload list — which prints the filename in its own
 * column, so a name-prefixed message truncates to just the name and tells the
 * user nothing. That is what happened on 2026-08-16: a rejected .CR3 showed
 * "Daren Matsuoka_25-06-05_a16z..." as its explanation.
 */
describe("uploadRejectionReason", () => {
  it("says nothing about a file it accepts", () => {
    expect(
      uploadRejectionReason({ name: "a.jpg", type: "image/jpeg", size: 5_000 })
    ).toBeNull();
  });

  it("never includes the filename — that column already exists", () => {
    const reason = uploadRejectionReason({
      name: "Daren Matsuoka_25-06-05_a16z_set1_1080.CR3",
      type: "",
      size: 10_700_000,
    });
    expect(reason).not.toContain("Daren");
    expect(reason).not.toContain(".CR3");
  });

  it("names camera raw as raw, and says what to do instead", () => {
    // Browsers report no MIME for most raw, so this must match on extension.
    expect(
      uploadRejectionReason({ name: "x.CR3", type: "", size: 10_000_000 })
    ).toBe("camera raw (CR3) isn't supported — export a JPEG");
    expect(
      uploadRejectionReason({ name: "x.nef", type: "", size: 10_000_000 })
    ).toBe("camera raw (NEF) isn't supported — export a JPEG");
    expect(
      uploadRejectionReason({ name: "x.arw", type: "", size: 10_000_000 })
    ).toBe("camera raw (ARW) isn't supported — export a JPEG");
  });

  it("names layered documents", () => {
    expect(
      uploadRejectionReason({
        name: "CEMA_BOD_19-09-16_0007.psd",
        type: "image/vnd.adobe.photoshop",
        size: 356_000_000,
      })
    ).toBe("PSD isn't supported — flatten and export a JPEG");
  });

  it("falls back to naming the extension rather than saying nothing useful", () => {
    expect(
      uploadRejectionReason({ name: "notes.pdf", type: "application/pdf", size: 10 })
    ).toBe("PDF isn't a supported format");
  });

  it("still routes HEIC to the convert-to-JPEG instructions", () => {
    expect(
      uploadRejectionReason({ name: "IMG_1.HEIC", type: "", size: 1_000_000 })
    ).toContain("HEIC isn't supported");
  });

  it("checks the size cap only for a format it would otherwise take", () => {
    // A 300 MB PSD is refused for being a PSD, not for being large — telling
    // someone to shrink a file we would never accept sends them off to do
    // useless work.
    expect(
      uploadRejectionReason({
        name: "big.psd",
        type: "image/vnd.adobe.photoshop",
        size: 356_000_000,
      })
    ).toContain("PSD");
    expect(
      uploadRejectionReason({
        name: "big.jpg",
        type: "image/jpeg",
        size: IMAGE_MAX_BYTES + 1,
      })
    ).toBe("images can be up to 100 MB");
  });

  it("keeps validateUploadFile prefixed, since the presign route reports in bulk", () => {
    expect(
      validateUploadFile({ name: "x.CR3", type: "", size: 10_000_000 })
    ).toBe("x.CR3: camera raw (CR3) isn't supported — export a JPEG");
  });
});

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

  it("rejects non-media formats, naming the format it turned away", () => {
    // Was asserting /unsupported/i, which pinned the old copy rather than the
    // behaviour. The message now names the extension ("PDF isn't a supported
    // format") because a rejected row shows the reason with no room for the
    // filename — so what matters is that the reason identifies the format.
    const msg = validateUploadFile({
      name: "doc.pdf",
      type: "application/pdf",
      size: 10,
    });
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/PDF/);
    expect(msg).toMatch(/not a supported|isn't a supported/i);
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

describe("extensionForMime", () => {
  // SPS names an AI render after its source JPEG and stores it as WebP. The
  // archive stores the extension the BYTES deserve; a `.jpg` full of WebP
  // opens nowhere, and the ZIP writes original_filename verbatim.
  it("corrects a name whose extension contradicts the mime", () => {
    expect(extensionForMime("image/webp", "jpg")).toBe("webp");
    expect(extensionForMime("image/jpeg", "webp")).toBe("jpg");
  });

  it("leaves a fitting extension alone, including the long form", () => {
    expect(extensionForMime("image/jpeg", "jpg")).toBe("jpg");
    expect(extensionForMime("image/jpeg", "jpeg")).toBe("jpeg");
    expect(extensionForMime("image/jpeg", "JPG")).toBe("JPG");
  });

  it("keeps the name's extension when the mime is unknown or missing", () => {
    // A guess is worse than the name — the name at least came from a human.
    expect(extensionForMime("application/octet-stream", "jpg")).toBe("jpg");
    expect(extensionForMime(null, "png")).toBe("png");
    expect(extensionForMime("", "dng")).toBe("dng");
  });

  it("ignores mime parameters", () => {
    expect(extensionForMime("image/webp; charset=binary", "jpg")).toBe("webp");
  });
});
