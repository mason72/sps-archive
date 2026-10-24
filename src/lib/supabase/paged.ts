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
