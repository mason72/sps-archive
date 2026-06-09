import { getThumbnailKey, getDisplayKey } from "@/lib/r2/client";
import { copyToPublicLane, deleteFromPublicLane } from "@/lib/r2/public-lane";

/**
 * Publish / un-publish a curated image to the public marketing lane.
 *
 * We expose exactly two variants to the public bucket — never the raw original
 * full-res file:
 *   - thumbUrl ← thumb-md (400px JPEG): grid/card thumbnails on the site
 *   - fullUrl  ← display variant: the web-viewable original for JPEG/PNG/etc.,
 *                or the 800px thumb-lg for non-renderable formats (TIFF)
 *
 * Keys are preserved 1:1 between buckets, so the public URL is simply
 * getPublicLaneUrl(thumbKey) / getPublicLaneUrl(displayKey).
 */

/** The two R2 keys that get mirrored into the public lane for a given image. */
export function publicLaneKeys(r2Key: string): { thumbKey: string; displayKey: string } {
  return {
    thumbKey: getThumbnailKey(r2Key, "thumb-md"),
    displayKey: getDisplayKey(r2Key),
  };
}

/** Copy an image's public variants into sps-public. Safe to call repeatedly. */
export async function publishImageToLane(r2Key: string): Promise<void> {
  const { thumbKey, displayKey } = publicLaneKeys(r2Key);
  // displayKey can equal thumbKey only in degenerate cases; copy both, de-duped.
  const keys = Array.from(new Set([thumbKey, displayKey]));
  await Promise.all(keys.map((k) => copyToPublicLane(k)));
}

/** Remove an image's public variants from sps-public. */
export async function unpublishImageFromLane(r2Key: string): Promise<void> {
  const { thumbKey, displayKey } = publicLaneKeys(r2Key);
  const keys = Array.from(new Set([thumbKey, displayKey]));
  await Promise.all(keys.map((k) => deleteFromPublicLane(k)));
}
