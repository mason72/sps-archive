/**
 * An in-memory stand-in for the PostgREST client, for tests of the SPS pull
 * lane's read paths. Not a simulator: it knows the handful of builder calls
 * those paths make, over three tables.
 *
 * The one thing it must be faithful about is the RESPONSE CAP. PostgREST
 * returns at most 1,000 rows whatever was asked for and says nothing when it
 * cuts, so a paged read that stops early looks complete. A fake without the
 * cap cannot test paging at all.
 */
type Rec = Record<string, unknown>;

export interface FakeState {
  sections: Rec[];
  images: Rec[];
  section_images: Rec[];
}

/** PostgREST returns at most this many rows whatever was asked for. */
export const RESPONSE_CAP = 1000;

export function fakeDb(state: FakeState, opts: { failOn?: keyof FakeState } = {}) {
  const inserts: string[] = [];
  const reads: string[] = [];
  const from = (table: keyof FakeState) => {
    const filters: ((r: Rec) => boolean)[] = [];
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    let single = false;
    let inserted: Rec | null = null;
    const builder = {
      select: () => builder,
      insert: (values: Rec) => {
        inserts.push(table);
        inserted = { id: `new-${table}-${state[table].length}`, locked: false, ...values };
        state[table].push(inserted);
        return builder;
      },
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), builder),
      gt: (col: string, v: string) => (filters.push((r) => String(r[col]) > v), builder),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), builder),
      // Only the one form the lane uses: `.not(col, "is", null)`.
      not: (col: string) =>
        (filters.push((r) => r[col] !== null && r[col] !== undefined), builder),
      ilike: (col: string, v: string) =>
        (filters.push((r) => String(r[col]).toLowerCase() === v.toLowerCase()), builder),
      order: (col: string, o?: { ascending?: boolean }) => {
        order = { col, asc: o?.ascending ?? true };
        return builder;
      },
      limit: (n: number) => ((limit = n), builder),
      maybeSingle: () => ((single = true), builder),
      single: () => ((single = true), builder),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const answer = () => {
          if (inserted) return { data: inserted, error: null };
          reads.push(table);
          if (opts.failOn === table) {
            return { data: null, error: { message: "canceling statement due to statement timeout" } };
          }
          let rows = state[table].filter((r) => filters.every((f) => f(r)));
          if (order) {
            const { col, asc } = order;
            rows = [...rows].sort((a, b) => {
              const [x, y] = [a[col] as string | number, b[col] as string | number];
              return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
            });
          }
          rows = rows.slice(0, Math.min(limit ?? RESPONSE_CAP, RESPONSE_CAP));
          return { data: single ? (rows[0] ?? null) : rows, error: null };
        };
        return Promise.resolve(answer()).then(resolve, reject);
      },
    };
    return builder;
  };
  return { db: { from } as unknown, inserts, reads };
}
