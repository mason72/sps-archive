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

/**
 * Presigned-URL memo for GRID THUMBNAILS.
 *
 * Presigning embeds a fresh timestamp+signature, so naively re-signing on
 * every event fetch hands the browser a brand-new URL for an unchanged file —
 * the cache misses and the whole grid re-downloads. During an upload session
 * (live refresh every ~1.5s) that meant constantly re-fetching hundreds of
 * progressive JPEGs over a saturated connection: tiles sat on their blurry
 * first scan. Reusing the SAME signed URL while it has plenty of life left
 * keeps the URL string byte-identical across fetches, so the browser cache
 * actually works.
 *
 * Per-instance memory (serverless): cold starts re-sign, which is fine — the
 * win is URL stability within a browsing/upload session against a warm
 * instance. Use for immutable grid assets only; downloads should stay fresh.
 */
const signedUrlCache = new Map<string, { url: string; expiresAtMs: number }>();

export async function getCachedThumbnailUrl(
  key: string,
  expiresIn = 14400
): Promise<string> {
  const cached = signedUrlCache.get(key);
  // Reuse while at least half the validity window remains, so a URL handed
  // out from cache is never close to expiry.
  if (cached && cached.expiresAtMs - Date.now() > (expiresIn * 1000) / 2) {
    return cached.url;
  }
  const url = await getPresignedDownloadUrl(key, expiresIn);
  if (signedUrlCache.size > 20000) signedUrlCache.clear(); // crude bound
  signedUrlCache.set(key, { url, expiresAtMs: Date.now() + expiresIn * 1000 });
  return url;
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

/** Image formats a browser can render directly in an <img> tag. */
const WEB_VIEWABLE_EXTS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

/** Is this original directly renderable in the browser? (TIFF/etc. are not.) */
export function isWebViewable(key: string): boolean {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return WEB_VIEWABLE_EXTS.has(ext);
}

/**
 * The key to use for *displaying* an image (lightbox / full view).
 *
 * Browsers can't render TIFF (and other non-web formats) in an <img>, so for
 * those we fall back to the largest JPEG thumbnail (thumb-lg, 800px). The raw
 * original is still served separately for download. Web-viewable originals
 * (JPEG/PNG/WebP/…) display at full resolution as before.
 */
export function getDisplayKey(r2Key: string): string {
  return isWebViewable(r2Key) ? r2Key : getThumbnailKey(r2Key, "thumb-lg");
}
