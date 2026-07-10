import sharp from "sharp";
import {
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { uploadToR2, buildImageKey } from "@/lib/r2/client";

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

const VARIANTS = [
  { name: "thumb-sm" as const, width: 200, quality: 75 },
  { name: "thumb-md" as const, width: 400, quality: 80 },
  { name: "thumb-lg" as const, width: 800, quality: 85 },
];

export interface ThumbnailResult {
  sm: string;
  md: string;
  lg: string;
  width: number | null;
  height: number | null;
  /** "#RRGGBB" dominant hue — the gallery's loading-placeholder color (G1). */
  dominantColor: string | null;
}

/**
 * Generate three thumbnail sizes from an original image in R2.
 *
 * Downloads the original, resizes with sharp, and uploads the
 * thumbnails back to R2 under events/{eventId}/thumbnails/{variant}/{filename}.
 *
 * Returns the R2 keys for each generated thumbnail plus the original's
 * pixel dimensions.
 */
export async function generateThumbnails(
  r2Key: string,
  eventId: string,
  filename: string
): Promise<ThumbnailResult> {
  // Download original from R2
  const response = await R2.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: r2Key })
  );

  if (!response.Body) {
    throw new Error(`Failed to download ${r2Key} from R2`);
  }

  const originalBuffer = Buffer.from(
    await response.Body.transformToByteArray()
  );

  return generateThumbnailsFromBuffer(originalBuffer, eventId, filename);
}

/**
 * Generate three thumbnail sizes from an in-memory image buffer.
 *
 * Used by the proxy upload route, which already holds the original bytes —
 * so we skip the R2 re-download. Called AWAITED inside the request so the
 * serverless function stays alive until thumbnails are written (the old
 * fire-and-forget version froze after the response and silently failed).
 *
 * Also reads the original's pixel dimensions (cheap with the buffer in hand)
 * so callers can persist width/height — used by the lightbox and as a masonry
 * hint. EXIF orientation is honoured so portrait/landscape is reported as
 * displayed.
 */
export async function generateThumbnailsFromBuffer(
  originalBuffer: Buffer,
  eventId: string,
  filename: string
): Promise<ThumbnailResult> {
  // Normalize filename to .jpg for thumbnails
  const thumbFilename = filename.replace(/\.[^.]+$/, ".jpg");

  // Read dimensions (orientation-aware).
  let width: number | null = null;
  let height: number | null = null;
  try {
    const meta = await sharp(originalBuffer).metadata();
    const rotated = !!meta.orientation && meta.orientation >= 5; // 90°/270°
    width = (rotated ? meta.height : meta.width) ?? null;
    height = (rotated ? meta.width : meta.height) ?? null;
  } catch {
    // dimensions are a nice-to-have, not required
  }

  // Dominant color for the gallery's loading placeholder (G1). Computed on a
  // tiny resize so it's near-free; a failure just means a stone placeholder.
  let dominantColor: string | null = null;
  try {
    const { dominant } = await sharp(originalBuffer)
      .resize(64, 64, { fit: "inside" })
      .stats();
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    dominantColor = `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch {
    // optional
  }

  // Generate and upload all three sizes. `.rotate()` (no args) bakes the
  // EXIF orientation into the pixels — without it, sharp strips the tag on
  // output and every orientation≠1 original (most phone shots) comes out
  // sideways. Thumbs also stay EXIF-free (no GPS leak on public variants).
  const results = await Promise.all(
    VARIANTS.map(async (variant) => {
      const resized = await sharp(originalBuffer)
        .rotate()
        .resize(variant.width, undefined, { withoutEnlargement: true })
        .jpeg({ quality: variant.quality, mozjpeg: true })
        .toBuffer();

      const key = buildImageKey(eventId, thumbFilename, variant.name);
      await uploadToR2(key, resized, "image/jpeg");
      return { variant: variant.name, key };
    })
  );

  return {
    sm: results.find((r) => r.variant === "thumb-sm")!.key,
    md: results.find((r) => r.variant === "thumb-md")!.key,
    lg: results.find((r) => r.variant === "thumb-lg")!.key,
    width,
    height,
    dominantColor,
  };
}
