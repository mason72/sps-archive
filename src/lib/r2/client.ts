import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { PassThrough } from "node:stream";

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

/**
 * Build a `Content-Disposition: attachment` value that survives both ASCII
 * and Unicode filenames (RFC 6266: ascii `filename=` for old clients, plus
 * `filename*=UTF-8''` for the rest).
 */
function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    filename
  )}`;
}

/**
 * Generate a presigned download URL.
 *
 * Pass `filename` for the SAVE path: it signs `ResponseContentDisposition:
 * attachment`, so the browser downloads the file (to Downloads) on a plain
 * navigation. Without it, the `download` attribute on an <a> is the only
 * hint — and browsers IGNORE that for cross-origin URLs (R2 is a different
 * origin), so the link just opens the image in a tab instead. Omit `filename`
 * for display/lightbox URLs, which must render inline.
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
  filename?: string
): Promise<string> {
  return getSignedUrl(
    R2,
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: attachmentDisposition(filename) }
        : {}),
    }),
    { expiresIn }
  );
}

/**
 * DETERMINISTIC presigned URLs for GRID THUMBNAILS.
 *
 * Presigning embeds a timestamp+signature, so naively re-signing on every
 * event fetch hands the browser a brand-new URL for an unchanged file — the
 * cache misses and the whole grid re-downloads. During an upload session
 * (live refresh every ~1.5s) that meant constantly re-fetching hundreds of
 * progressive JPEGs over a saturated connection: tiles sat on their blurry
 * first scan.
 *
 * SigV4 is fully deterministic given the same signing inputs, so quantizing
 * the signing time to a half-expiry window makes every server — across
 * serverless instances AND cold starts — produce the byte-identical URL (a
 * per-instance memo alone proved useless on Vercel: consecutive requests hit
 * different lambdas). URLs rotate once per window with at least half their
 * validity remaining, and the browser cache holds within a session.
 *
 * Use for immutable grid assets only; downloads should stay freshly signed.
 */
const signedUrlMemo = new Map<string, string>();

export async function getCachedThumbnailUrl(
  key: string,
  expiresIn = 14400
): Promise<string> {
  const windowMs = (expiresIn * 1000) / 2;
  const signingDate = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const memoKey = `${signingDate.getTime()}:${key}`;

  const memoized = signedUrlMemo.get(memoKey);
  if (memoized) return memoized;

  const url = await getSignedUrl(
    R2,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn, signingDate }
  );
  if (signedUrlMemo.size > 20000) signedUrlMemo.clear(); // crude bound
  signedUrlMemo.set(memoKey, url);
  return url;
}

/**
 * Stream an arbitrary-size body into R2 via multipart upload. Unlike
 * PutObject-with-a-Buffer, this consumes the stream with real backpressure
 * (parts are read on demand), so a multi-GB ZIP build holds ~queueSize x
 * partSize in memory, never the whole archive.
 */
export async function uploadStreamToR2(
  key: string,
  body: NodeJS.ReadableStream,
  contentType: string
): Promise<void> {
  // lib-storage instanceof-checks against node:stream's Readable, which
  // userland streams (archiver extends readable-stream) fail — pipe through
  // a genuine PassThrough. Backpressure is preserved: pipe() pauses the
  // source when the PassThrough (and thus the multipart reader) is busy.
  const bridge = new PassThrough();
  body.pipe(bridge);
  const upload = new Upload({
    // The dep tree resolves lib-storage and client-s3 to different @smithy
    // type versions; the wire protocol is identical — cast at the boundary.
    client: R2 as unknown as ConstructorParameters<typeof Upload>[0]["client"],
    params: { Bucket: BUCKET, Key: key, Body: bridge, ContentType: contentType },
    partSize: 16 * 1024 * 1024,
    queueSize: 3,
    leavePartsOnError: false,
  });
  await upload.done();
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

/** Video containers the upload pipeline accepts. */
const VIDEO_EXTS = new Set(["mp4", "mov"]);

/** Is this original directly renderable in the browser? (TIFF/etc. are not.) */
export function isWebViewable(key: string): boolean {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return WEB_VIEWABLE_EXTS.has(ext);
}

/** Is this original a video, by container extension? */
export function isVideoKey(key: string): boolean {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return VIDEO_EXTS.has(ext);
}

/**
 * The key of a video's web-playable rendition.
 *
 * MP4 originals play everywhere, so they pass through 1:1. QuickTime (.mov)
 * containers don't play in Firefox, so the video pipeline remuxes them
 * losslessly (-c copy) to events/{eventId}/video/{filename}.mp4 and that
 * rendition is what display/publish use. The raw original stays untouched
 * for download fidelity.
 */
export function getVideoDisplayKey(r2Key: string): string {
  if (r2Key.toLowerCase().endsWith(".mp4")) return r2Key;
  const parts = r2Key.split("/");
  // parts = ["events", eventId, "originals", filename]
  if (parts.length < 4 || parts[2] !== "originals") return r2Key;
  const eventId = parts[1];
  const filename = parts.slice(3).join("/");
  return `events/${eventId}/video/${filename.replace(/\.[^.]+$/, ".mp4")}`;
}

/**
 * The key to use for *displaying* an asset (lightbox / full view / site).
 *
 * Browsers can't render TIFF (and other non-web formats) in an <img>, so for
 * those we fall back to the largest JPEG thumbnail (thumb-lg, 800px). The raw
 * original is still served separately for download. Web-viewable originals
 * (JPEG/PNG/WebP/…) display at full resolution as before. Video originals
 * resolve to their web-playable mp4 rendition (for a <video> tag — posters
 * for <img> contexts come from the thumbnail variants instead).
 */
export function getDisplayKey(r2Key: string): string {
  if (isVideoKey(r2Key)) return getVideoDisplayKey(r2Key);
  return isWebViewable(r2Key) ? r2Key : getThumbnailKey(r2Key, "thumb-lg");
}
