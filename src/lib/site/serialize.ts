import { getThumbnailKey } from "@/lib/r2/client";
import { getPublicLaneUrl } from "@/lib/r2/public-lane";
import { streamHlsUrl, streamIframeUrl } from "@/lib/stream/client";
import { publicLaneKeys } from "./publish";

/**
 * One asset entry as the site-facing APIs (scene + jobs) serve it.
 *
 * The image shape predates video and is FROZEN — existing fields keep their
 * exact semantics so the marketing site never breaks. Video adds:
 *   - kind:     "image" | "video" (R2-lane mp4) | "stream" (Cloudflare Stream)
 *   - duration: seconds, for badges/UX
 *   - posterUrl: large (800px) poster JPEG — what you show before playback
 *   - videoUrl: the playable source — public mp4 for "video", HLS manifest
 *               for "stream" (streamUid is included for iframe embeds)
 *
 * fullUrl stays <img>-safe for every kind: for videos it carries the large
 * poster, never an mp4, so any legacy image consumer renders sensibly.
 */

/** The columns the site APIs select for each member asset. */
export const SITE_ASSET_COLUMNS =
  "id, r2_key, original_filename, width, height, service, featured, created_at, focal_x, focal_y, media_type, duration_seconds, stream_uid, events!event_id(name, city)";

export interface SiteAssetRow {
  id: string;
  r2_key: string;
  original_filename: string | null;
  width: number | null;
  height: number | null;
  service: string | null;
  featured: boolean;
  created_at: string;
  focal_x: number | null;
  focal_y: number | null;
  media_type: string;
  duration_seconds: number | null;
  stream_uid: string | null;
  events: { name: string | null; city: string | null } | null;
}

export function serializeSiteAsset(
  img: SiteAssetRow,
  fallbackService: string | null = null
) {
  const event = img.events ?? { name: null, city: null };
  const { thumbKey, displayKey } = publicLaneKeys(img.r2_key);
  const isVideo = img.media_type === "video";
  const kind = isVideo ? (img.stream_uid ? "stream" : "video") : "image";
  const posterKey = isVideo ? getThumbnailKey(img.r2_key, "thumb-lg") : null;

  return {
    id: img.id,
    /* Upload filename — catalog-style consumers (the backdrop picker) join
       structured entries to images by basename. */
    name: img.original_filename ?? null,
    event: event.name ?? null,
    city: event.city ?? null,
    service: img.service ?? fallbackService,
    featured: img.featured ?? false,
    width: img.width,
    height: img.height,
    thumbUrl: getPublicLaneUrl(thumbKey),
    fullUrl: posterKey
      ? getPublicLaneUrl(posterKey)
      : getPublicLaneUrl(displayKey),
    focalX: img.focal_x ?? null,
    focalY: img.focal_y ?? null,
    kind,
    duration: img.duration_seconds ?? null,
    posterUrl: posterKey ? getPublicLaneUrl(posterKey) : null,
    videoUrl:
      kind === "stream"
        ? streamHlsUrl(img.stream_uid as string)
        : kind === "video"
        ? getPublicLaneUrl(displayKey)
        : null,
    iframeUrl:
      kind === "stream" ? streamIframeUrl(img.stream_uid as string) : null,
    streamUid: kind === "stream" ? img.stream_uid : null,
  };
}
