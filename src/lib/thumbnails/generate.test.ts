import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("@/lib/r2/client", () => ({
  R2_REQUEST_HANDLER: { connectionTimeout: 10_000, socketTimeout: 120_000 },
  uploadToR2: vi.fn().mockResolvedValue(undefined),
  buildImageKey: (eventId: string, filename: string, variant?: string) =>
    variant
      ? `events/${eventId}/thumbnails/${variant}/${filename}`
      : `events/${eventId}/originals/${filename}`,
}));

import { generateThumbnailsFromBuffer, isUndecodableImageError } from "./generate";
import { uploadToR2 } from "@/lib/r2/client";

/** A 100×50 JPEG tagged EXIF orientation=6 (i.e. displays as 50×100 portrait). */
async function rotatedJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 100,
      height: 50,
      channels: 3,
      background: { r: 200, g: 30, b: 30 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("generateThumbnailsFromBuffer", () => {
  it("reports orientation-corrected display dimensions", async () => {
    const result = await generateThumbnailsFromBuffer(
      await rotatedJpeg(),
      "evt1",
      "photo.jpg"
    );
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
  });

  it("bakes EXIF orientation into thumbnail pixels (no sideways thumbs)", async () => {
    await generateThumbnailsFromBuffer(await rotatedJpeg(), "evt1", "photo.jpg");

    const uploaded = vi.mocked(uploadToR2).mock.calls;
    expect(uploaded.length).toBe(3);
    for (const [key, buffer] of uploaded) {
      const meta = await sharp(buffer as Buffer).metadata();
      // Portrait source must yield portrait thumbnails; the orientation tag
      // is gone (sharp strips EXIF), so the pixels themselves must be upright.
      expect(meta.height!, String(key)).toBeGreaterThan(meta.width!);
      expect(meta.orientation).toBeUndefined();
    }
  });
});

describe("isUndecodableImageError", () => {
  it("matches what sharp says about a damaged file", () => {
    expect(isUndecodableImageError(new Error("VipsJpeg: premature end of JPEG image"))).toBe(true);
    expect(isUndecodableImageError(new Error("Input buffer contains unsupported image format"))).toBe(true);
    expect(isUndecodableImageError(new Error("vipspng: libpng read error"))).toBe(true);
    expect(isUndecodableImageError(new Error("Input Buffer is empty"))).toBe(true);
  });
  it("does not match storage or network trouble, which a retry can fix", () => {
    expect(isUndecodableImageError(new Error("Failed to download x from R2"))).toBe(false);
    expect(isUndecodableImageError(new Error("socket hang up"))).toBe(false);
    expect(isUndecodableImageError({ code: "ECONNRESET" })).toBe(false);
  });
  it("does not match libvips running out of memory or temp space", () => {
    expect(isUndecodableImageError(new Error("vips_tracked: out of memory --- size == 512MB"))).toBe(false);
    expect(isUndecodableImageError(new Error("vips__file_open_write: unable to open file /tmp/x for writing"))).toBe(false);
  });
});

describe("a truncated JPEG, decoded for real", () => {
  it("is classed as damaged", async () => {
    const whole = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#808080" } })
      .jpeg()
      .toBuffer();
    const cut = whole.subarray(0, Math.floor(whole.length / 2));
    const err = await sharp(cut)
      .resize(32)
      .jpeg()
      .toBuffer()
      .then(() => null, (e: unknown) => e);
    expect(err).not.toBeNull();
    expect(isUndecodableImageError(err)).toBe(true);
  });
});
