/**
 * Read EVERY row of a query, in pages, so PostgREST's silent 1,000-row cap
 * can never truncate it.
 *
 * Why this exists (2026-10-23): the SPS import list read the photographer's
 * events with one bare select to decide which SPS events were "already in the
 * archive". The account had 1,382 events, the select answered 1,000 with no
 * error, and every event linked after the cap showed up as a fresh import
 * again — Grafana, Meta, Stampli, both Stanford reunions, WebexOne. The same
 * shape was in six other places (search scope, stats, the People index, Event
 * Intel, the link and unlink routes), each one a quiet wrong answer waiting on
 * the row count. Lesson 39 said "page it" and had been applied one site at a
 * time; this is the one home.
 *
 * Rules the helper enforces so a caller cannot forget them:
 *   - pages are ORDERED by `id` (a unique column) — OFFSET paging without an
 *     order duplicates and skips rows between pages (lesson 88);
 *   - a caller's own `.order()` stays first; `id` is appended as the tiebreaker;
 *   - the loop stops only when a page comes back short, never on a count.
 *
 * `makeQuery` must build a FRESH builder each call: a PostgREST builder is a
 * mutable object, and re-ranging one that already ran is not a supported path.
 *
 *   const events = await readAllRows(() =>
 *     supabase.from("events").select("id, name").eq("user_id", userId)
 *   );
 */

export const READ_PAGE_SIZE = 1000;

export interface PagedResult<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

/** The slice of a PostgREST builder the loop needs. */
export interface Pageable<Row> {
  order(column: "id", options?: { ascending?: boolean }): {
    range(from: number, to: number): PromiseLike<PagedResult<Row>>;
  };
}

export async function readAllRows<Row>(
  makeQuery: () => Pageable<Row>,
  pageSize = READ_PAGE_SIZE
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let page = 0; ; page++) {
    const from = page * pageSize;
    const { data, error } = await makeQuery()
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const got = data ?? [];
    rows.push(...got);
    if (got.length < pageSize) return rows;
  }
}

/**
 * Concurrent requests per paged read: the parallel readers (the guest
 * gallery's photos, `loadSectionLinks`, the editor's photos) fetch the pages
 * after the first at most this many at a time. Each OFFSET page re-sorts the
 * whole set in Postgres, and a share email sends many guests at once, so an
 * unbounded fan-out (16 pages for an 8,000-photo gallery) multiplies into the
 * statement-timeout bursts this project has already had (lesson 199).
 */
export const PAGE_FETCH_CONCURRENCY = 4;

/**
 * Pages `from` to `to - 1`, in order, at most `inFlight` requests at a time.
 * THROWS the first page error as soon as its wave returns, so a timeout does
 * not fire every later wave into the database that just timed out. The caller
 * decides completion (a short last page), as the readers above do.
 */
export async function fetchPagesInWaves<T extends { error: unknown }>(
  page: (index: number) => PromiseLike<T>,
  from: number,
  to: number,
  inFlight = PAGE_FETCH_CONCURRENCY
): Promise<T[]> {
  const out: T[] = [];
  for (let i = from; i < to; i += inFlight) {
    const wave = await Promise.all(
      Array.from({ length: Math.min(inFlight, to - i) }, (_, k) => page(i + k))
    );
    for (const r of wave) if (r.error) throw r.error;
    out.push(...wave);
  }
  return out;
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
 * Sum an exact count over an id list, 100 ids per request.
 *
 * Why chunked (2026-11-03): the dashboard sent all of a photographer's event
 * ids in ONE `in()` filter. At 1,457 events that is a 56,874-character URL,
 * the gateway answered 400, and because a count is a HEAD request there was no
 * body, so the error read `{"message":""}` and every dashboard load since the
 * account crossed a few hundred events emailed an alarm that said nothing.
 * The HTTP status is on the result, not the error, so it goes into the thrown
 * message here.
 */
export async function countAcross(
  ids: string[],
  what: string,
  count: (chunk: string[]) => PromiseLike<{
    count: number | null;
    error: { message: string } | null;
    status: number;
  }>
): Promise<number> {
  const chunks = idChunks(ids);
  const results = await fetchPagesInWaves(
    (i) =>
      Promise.resolve(count(chunks[i])).then((r) => ({
        ...r,
        error: r.error
          ? new Error(`${what} count failed: HTTP ${r.status}${r.error.message ? `, ${r.error.message}` : ""}`)
          : null,
      })),
    0,
    chunks.length
  );
  // A bodiless 404 comes back as { error: null, count: null }; adding it as 0
  // would make a missing table read as an empty one.
  for (const r of results) {
    if (r.count === null) throw new Error(`${what} count failed: HTTP ${r.status} with no count`);
  }
  return results.reduce((sum, r) => sum + (r.count ?? 0), 0);
}
