import { readAllRows, type Pageable } from "@/lib/supabase/paged";

/**
 * How many PHOTOS a recap counts, as opposed to how many image rows.
 *
 * One photo can sit in an event as several rows: F1 Cash App holds every
 * frame twice, the framed SPS export in "Overlay" and the clean print in
 * "Prints", under the same filename, and the recap page said "896 finished
 * photos" for a 448-frame event (2026-10-26). Pixieset ingests do the same
 * with edited and web-size variants (Jordan X Kids Foot Locker: 588 rows,
 * 330 photos).
 *
 * The key is `original_filename`. Measured across the whole archive on
 * 2026-10-26 (re-run: `npx tsx scripts/triage/photo-name-collisions.ts`): of
 * the same-name groups whose rows all carry a capture time, every one shares
 * a single time, except F1, whose two copies differ only because SPS stamps
 * the re-upload time. Not one group put two different pictures under one
 * name. If two cameras ever collide on a name in one event (or a guest sits
 * twice at a multi-day event and the names carry no date), this undercounts
 * by the collisions; that is the accepted cost.
 *
 * A row with no filename counts on its own (keyed by id), so a missing name
 * can never merge two photos.
 */

export interface PhotoCountRow {
  id: string;
  original_filename: string | null;
  parsed_name: string | null;
}

export interface PhotoCount {
  /** Distinct photos. */
  photos: number;
  /** Of those, carrying a person's name in any of its versions. */
  named: number;
}

export function countDistinctPhotos(rows: readonly PhotoCountRow[]): PhotoCount {
  const named = new Map<string, boolean>();
  for (const r of rows) {
    const name = r.original_filename?.trim();
    const key = name ? `f:${name}` : `id:${r.id}`;
    named.set(key, (named.get(key) ?? false) || !!r.parsed_name);
  }
  let n = 0;
  for (const v of named.values()) if (v) n++;
  return { photos: named.size, named: n };
}

/** PostgREST puts an `in()` list in the GET URL; past ~500 uuids the fetch fails. */
const ID_CHUNK = 100;

/** Split an id list for `in()` filters (see ID_CHUNK). */
export function idChunks(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK));
  return out;
}

/**
 * Read the rows a recap counts. `makeQuery(chunk)` builds a FRESH query for
 * the event's photos, limited to `chunk` ids when it is not null (a
 * hand-picked share). Every page is read, and an error throws rather than
 * letting a short read stand as the count.
 */
export async function readPhotoCountRows(
  makeQuery: (ids: string[] | null) => Pageable<PhotoCountRow>,
  selected: ReadonlySet<string> | null
): Promise<PhotoCountRow[]> {
  if (!selected) return readAllRows(() => makeQuery(null));
  const rows: PhotoCountRow[] = [];
  for (const chunk of idChunks([...selected])) {
    rows.push(...(await readAllRows(() => makeQuery(chunk))));
  }
  return rows;
}
