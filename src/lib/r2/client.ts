import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME!;

/** Upload a file buffer to R2 */
export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<{ key: string; url: string }> {
  await R2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );

  return {
    key,
    url: `${process.env.R2_PUBLIC_URL}/${key}`,
  };
}

/** Generate a presigned upload URL for direct client-side uploads */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  return getSignedUrl(
    R2,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn }
  );
}

/** Generate a presigned download URL */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  return getSignedUrl(
    R2,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
    }),
    { expiresIn }
  );
}

/** Delete a file from R2 */
export async function deleteFromR2(key: string): Promise<void> {
  await R2.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: key,
    })
  );
}

/** Build the R2 key path for an image */
export function buildImageKey(
  eventId: string,
  filename: string,
  variant?: "thumb-sm" | "thumb-md" | "thumb-lg"
): string {
  const base = `events/${eventId}`;
  if (variant) {
    return `${base}/thumbnails/${variant}/${filename}`;
  }
  return `${base}/originals/${filename}`;
}

/** Get the public CDN URL for an image */
export function getPublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Derive a thumbnail key from an original r2_key.
 *
 * Original:  events/{eventId}/originals/{filename}
 * Thumbnail: events/{eventId}/thumbnails/{variant}/{filename}.jpg
 */
export function getThumbnailKey(
  r2Key: string,
  variant: "thumb-sm" | "thumb-md" | "thumb-lg" = "thumb-md"
): string {
  // Parse original key: events/{eventId}/originals/{filename}
  const parts = r2Key.split("/");
  // parts = ["events", eventId, "originals", filename]
  if (parts.length < 4 || parts[2] !== "originals") return r2Key;

  const eventId = parts[1];
  const filename = parts.slice(3).join("/");
  const thumbFilename = filename.replace(/\.[^.]+$/, ".jpg");
  return `events/${eventId}/thumbnails/${variant}/${thumbFilename}`;
}
