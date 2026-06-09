import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

/**
 * Public marketing lane (sps-public bucket).
 *
 * This is a SEPARATE bucket from the private client-gallery store (sps-prism).
 * Only images the team explicitly tags into a website scene get copied here, and
 * objects in this bucket are served over a public Cloudflare custom domain
 * (R2_PUBLIC_LANE_URL, e.g. https://cdn.pixeltrunk.com) with NO presigning and
 * NO expiry — exactly what a public marketing site needs.
 *
 * Private client galleries never touch this module; they keep using
 * `src/lib/r2/client.ts` with per-request presigned URLs against sps-prism.
 *
 * Credentials: the account-wide R2 token (R2_ACCESS_KEY_ID/SECRET) must have
 * read on the private bucket AND write on the public bucket, which lets us copy
 * objects bucket-to-bucket server-side (CopyObject) without streaming bytes
 * through the app server.
 */

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

/** Private source bucket (client galleries live here). */
const PRIVATE_BUCKET = process.env.R2_BUCKET_NAME ?? "sps-prism";
/** Public destination bucket (curated marketing imagery only). */
const PUBLIC_BUCKET = process.env.R2_PUBLIC_BUCKET_NAME ?? "sps-public";

/**
 * Build the public, non-expiring URL for an object in the public lane.
 *
 * Mirrors `getPublicUrl` in client.ts but reads R2_PUBLIC_LANE_URL — the public
 * custom domain bound to sps-public — so these URLs resolve without auth and
 * never expire. (R2_PUBLIC_URL in prod points at the PRIVATE S3 endpoint and
 * must NOT be used for public links.)
 */
export function getPublicLaneUrl(key: string): string {
  const base = process.env.R2_PUBLIC_LANE_URL?.replace(/\/$/, "") ?? "";
  return `${base}/${key}`;
}

/**
 * Copy an object from the private bucket into the public lane, preserving the
 * key path. Server-side bucket-to-bucket copy — no bytes through the app.
 *
 * CopySource is the URL-encoded `${bucket}/${key}` of the source object.
 */
export async function copyToPublicLane(key: string): Promise<void> {
  const copySource = encodeURI(`${PRIVATE_BUCKET}/${key}`);
  await R2.send(
    new CopyObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
      CopySource: copySource,
    })
  );
}

/** Remove an object from the public lane (used when un-tagging an image). */
export async function deleteFromPublicLane(key: string): Promise<void> {
  await R2.send(
    new DeleteObjectCommand({
      Bucket: PUBLIC_BUCKET,
      Key: key,
    })
  );
}
