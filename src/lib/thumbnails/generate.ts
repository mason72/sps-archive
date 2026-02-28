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

/**
 * Generate three thumbnail sizes from an original image in R2.
 *
 * Downloads the original, resizes with sharp, and uploads the
 * thumbnails back to R2 under events/{eventId}/thumbnails/{variant}/{filename}.
 *
 * Returns the R2 keys for each generated thumbnail.
 */
export async function generateThumbnails(
  r2Key: string,
  eventId: string,
  filename: string
): Promise<{ sm: string; md: string; lg: string }> {
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

  // Normalize filename to .jpg for thumbnails
  const thumbFilename = filename.replace(/\.[^.]+$/, ".jpg");

  // Generate and upload all three sizes
  const results = await Promise.all(
    VARIANTS.map(async (variant) => {
      const resized = await sharp(originalBuffer)
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
  };
}
