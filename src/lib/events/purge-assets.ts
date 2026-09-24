/**
 * R2 cleanup for a deleted event. The DB cascade removes rows only, so the
 * files must be listed BEFORE the event row goes and deleted after.
 *
 * Deleting by R2 prefix (`events/<id>/`) is NOT safe: a merge moves a row into
 * the kept event and leaves its file under the deleted event's folder
 * (scripts/merge-au2026.ts does exactly this). So cleanup goes key by key, and
 * a key another event's row still points at is kept.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { deleteImageAssets } from "@/lib/r2/client";

type Db = ReturnType<typeof createServiceClient>;

/** r2_key → media_type, one entry per distinct file. */
export type EventAssets = Map<string, string | null>;

/** R2 deletes in flight at once. */
const R2_DELETE_CONCURRENCY = 32;
/** Keys per reference-check query. `.in()` rides the URL, so keep it short. */
const KEY_CHECK_CHUNK = 100;

/**
 * Every file an event's image rows point at. Ordered by id, because unordered
 * OFFSET paging can skip and repeat rows (lesson 88) and a skipped row here is
 * a file nobody will ever delete. Throws on a read error: deleting the event
 * after a partial read orphans every file the read never reached.
 */
export async function collectEventAssets(db: Db, eventId: string): Promise<EventAssets> {
  const assets: EventAssets = new Map();
  for (let offset = 0; ; offset += 1000) {
    const { data: page, error } = await db
      .from("images")
      .select("r2_key, media_type")
      .eq("event_id", eventId)
      .order("id")
      .range(offset, offset + 999);
    if (error) throw error;
    for (const a of page ?? []) assets.set(a.r2_key, a.media_type);
    if (!page || page.length < 1000) break;
  }
  return assets;
}

/** The subset of `keys` that some image row still points at. */
export async function keysStillReferenced(db: Db, keys: string[]): Promise<Set<string>> {
  const referenced = new Set<string>();
  for (let i = 0; i < keys.length; i += KEY_CHECK_CHUNK) {
    const { data, error } = await db
      .from("images")
      .select("r2_key")
      .in("r2_key", keys.slice(i, i + KEY_CHECK_CHUNK));
    if (error) throw error;
    for (const r of data ?? []) referenced.add(r.r2_key);
  }
  return referenced;
}

export interface PurgeResult {
  /** Files whose objects were deleted (original + derivatives). */
  deleted: number;
  /** Files kept because another row still references them. */
  kept: number;
  /** Individual R2 object keys whose delete failed. */
  failedKeys: string[];
}

/**
 * Delete the R2 footprint of files whose rows are ALREADY gone. Run it after
 * the cascade: any row still carrying one of these keys then belongs to
 * another event, and its file stays.
 */
export async function purgeEventAssets(db: Db, assets: EventAssets): Promise<PurgeResult> {
  const keys = [...assets.keys()];
  const referenced = await keysStillReferenced(db, keys);
  const doomed = keys.filter((k) => !referenced.has(k));
  const failedKeys: string[] = [];
  for (let i = 0; i < doomed.length; i += R2_DELETE_CONCURRENCY) {
    const slice = doomed.slice(i, i + R2_DELETE_CONCURRENCY);
    const results = await Promise.all(slice.map((k) => deleteImageAssets(k, assets.get(k))));
    for (const f of results) failedKeys.push(...f);
  }
  return { deleted: doomed.length, kept: referenced.size, failedKeys };
}
