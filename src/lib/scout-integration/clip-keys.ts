/**
 * Every R2 key one Scout clip attempt can touch, derived from its two ids and
 * nothing else. The store writes these, and the delayed cleanup deletes these;
 * because the cleanup DERIVES the keys rather than being handed them, a bad
 * event can never point it at somebody else's objects.
 *
 *   staged   scout-staging/<event>/<image>.mp4      the pipeline's silent copy, before checks
 *   original events/<event>/originals/<image>.mp4   the filed copy, after checks
 *   posters  events/<event>/thumbnails/thumb-{sm,md,lg}/<image>.jpg
 *
 * The staging prefix is TOP-LEVEL on purpose: no gallery, purge, sweep, share
 * or ZIP path walks it, no row references it, and an R2 lifecycle rule (which
 * matches by prefix only) can expire all of it with one rule on
 * `scout-staging/` after 1 day, the backstop for a staged copy nothing else
 * removed. That rule is a release step (docs/TECHNICAL.md 9b).
 */
import { buildImageKey, getThumbnailKey } from "@/lib/r2/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The one prefix every staged Scout copy lives under (an R2 lifecycle rule expires it). */
export const SCOUT_STAGING_PREFIX = "scout-staging/";

export interface ClipKeys {
  stagedKey: string;
  r2Key: string;
  posterKeys: string[];
}

export function clipKeys(eventId: string, imageId: string): ClipKeys {
  if (!UUID.test(eventId) || !UUID.test(imageId)) {
    throw new Error("clipKeys: event and image ids must be uuids");
  }
  const r2Key = buildImageKey(eventId, `${imageId}.mp4`);
  return {
    stagedKey: `${SCOUT_STAGING_PREFIX}${eventId}/${imageId}.mp4`,
    r2Key,
    posterKeys: (["thumb-sm", "thumb-md", "thumb-lg"] as const).map((v) => getThumbnailKey(r2Key, v)),
  };
}
