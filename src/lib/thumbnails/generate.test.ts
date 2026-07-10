import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("@/lib/r2/client", () => ({
  uploadToR2: vi.fn().mockResolvedValue(undefined),
  buildImageKey: (eventId: string, filename: string, variant?: string) =>
    variant
      ? `events/${eventId}/thumbnails/${variant}/${filename}`
      : `events/${eventId}/originals/${filename}`,
}));

import { generateThumbnailsFromBuffer } from "./generate";
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
