import {
  getThumbnailKey,
  getDisplayKey,
  getPresignedDownloadUrl,
} from "@/lib/r2/client";
import { copyToPublicLane, deleteFromPublicLane } from "@/lib/r2/public-lane";
import {
  copyToStream,
  deleteFromStream,
  isStreamConfigured,
  needsStream,
} from "@/lib/stream/client";

/**
 * Publish / un-publish a curated asset to the public marketing lane.
 *
 * Images expose exactly two variants to the public bucket — never the raw
 * original full-res file:
 *   - thumbUrl ← thumb-md (400px JPEG): grid/card thumbnails on the site
 *   - fullUrl  ← display variant: the web-viewable original for JPEG/PNG/etc.,
 *                or the 800px thumb-lg for non-renderable formats (TIFF)
 *
 * Videos publish by lane (assetLane):
 *   - "video" (short muted loops, ≤60s and silent): the poster variants
 *     (thumb-md + thumb-lg, written by the video pipeline into the normal
 *     thumbnail scheme) plus the web-playable mp4 rendition — all via the R2
 *     public lane, same as images.
 *   - "stream" (long or sound-on showcase reels): the poster variants via the
 *     R2 lane, while playback comes from Cloudflare Stream — ingested here by
 *     presigned-URL copy on first publish, identified by the returned UID.
 *
 * Keys are preserved 1:1 between buckets, so the public URL is simply
 * getPublicLaneUrl(key).
 */

/** What the site sync needs to know about an asset to publish it. */
export interface SiteAsset {
  r2Key: string;
  mediaType: string; // "image" | "video"
  durationSeconds: number | null;
  hasAudio: boolean | null;
  /** Existing Stream UID, when this video was already ingested. */
  streamUid: string | null;
  /** Display name for the Stream library (original filename). */
  name?: string | null;
}

export type SiteAssetLane = "image" | "video" | "stream";

/** Which publishing lane serves this asset? */
export function assetLane(asset: {
  mediaType: string;
  durationSeconds: number | null;
  hasAudio: boolean | null;
}): SiteAssetLane {
  if (asset.mediaType !== "video") return "image";
  return needsStream(asset) ? "stream" : "video";
}

/** The two R2 keys that get mirrored into the public lane for a given image. */
export function publicLaneKeys(r2Key: string): { thumbKey: string; displayKey: string } {
  return {
    thumbKey: getThumbnailKey(r2Key, "thumb-md"),
    displayKey: getDisplayKey(r2Key),
  };
}

/** The R2 keys a given asset mirrors into the public lane. */
function laneKeysForAsset(asset: SiteAsset): string[] {
  const { thumbKey, displayKey } = publicLaneKeys(asset.r2Key);
  switch (assetLane(asset)) {
    case "image":
      return Array.from(new Set([thumbKey, displayKey]));
    case "video":
      // Poster small + large, plus the playable mp4 (displayKey is the mp4
      // rendition for video originals).
      return Array.from(
        new Set([thumbKey, getThumbnailKey(asset.r2Key, "thumb-lg"), displayKey])
      );
    case "stream":
      // Posters only — playback comes from Stream, never the public bucket.
      return Array.from(
        new Set([thumbKey, getThumbnailKey(asset.r2Key, "thumb-lg")])
      );
  }
}

/**
 * Copy an asset's public variants into sps-public — and, for stream-lane
 * videos, ensure a Cloudflare Stream copy exists. Safe to call repeatedly:
 * R2 copies are idempotent, and an existing streamUid is reused, never
 * re-ingested.
 *
 * Returns the Stream UID the caller should persist (null for R2-only lanes).
 */
export async function publishAssetToLane(
  asset: SiteAsset
): Promise<{ streamUid: string | null }> {
  await Promise.all(laneKeysForAsset(asset).map((k) => copyToPublicLane(k)));

  if (assetLane(asset) !== "stream") return { streamUid: null };
  if (asset.streamUid) return { streamUid: asset.streamUid };

  if (!isStreamConfigured()) {
    // Fail (not silently degrade): serving a multi-hundred-MB mp4 from the
    // public lane is worse than a retried publish. The membership sync logs
    // this per-asset and retries on the next sync once Stream is configured.
    throw new Error(
      "Cloudflare Stream is not configured — set CLOUDFLARE_STREAM_API_TOKEN " +
        "and CLOUDFLARE_STREAM_CUSTOMER_CODE to publish long or sound-on videos"
    );
  }

  // Stream pulls the original (any container it understands) straight from
  // the private bucket via a presigned GET — no bytes through the app.
  const sourceUrl = await getPresignedDownloadUrl(asset.r2Key, 3600);
  const uid = await copyToStream(sourceUrl, asset.name || asset.r2Key);
  return { streamUid: uid };
}

/** Remove an asset's public variants — and its Stream copy, if any. */
export async function unpublishAssetFromLane(asset: SiteAsset): Promise<void> {
  await Promise.all(laneKeysForAsset(asset).map((k) => deleteFromPublicLane(k)));

  if (asset.streamUid) {
    if (isStreamConfigured()) {
      await deleteFromStream(asset.streamUid);
    } else {
      // Can't reach Stream without credentials; don't block the unpublish —
      // the public lane is already clean, which is what privacy needs.
      console.warn(
        `Stream not configured — leaving orphaned Stream video ${asset.streamUid}`
      );
    }
  }
}
