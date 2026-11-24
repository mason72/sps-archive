/**
 * A small in-memory stand-in for the PostgREST client, for the Scout store's
 * tests only. It supports exactly the calls store.ts makes (select / insert /
 * update / delete with eq, in, filter, order, limit, single, maybeSingle),
 * the unique keys the store relies on (23505), and the cascades migration 102
 * and the images FKs declare. Not imported by any route.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = Record<string, any>;
type Result = { data: any; error: { code?: string; message: string } | null };

const UNIQUE: Record<string, ((r: Row) => string)[]> = {
  events: [(r) => `slug:${r.slug}`],
  scout_postcard_links: [(r) => `pk:${r.postcard_id}`],
  sections: [
    (r) => `name:${r.event_id}:${String(r.name).toLowerCase()}`,
    (r) => (r.job_meta?.scout_gig_id ? `gig:${r.event_id}:${r.job_meta.scout_gig_id}` : ""),
  ],
  section_images: [(r) => `pk:${r.section_id}:${r.image_id}`],
};

let seq = 0;
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export class FakeDb {
  tables: Record<string, Row[]> = {
    events: [],
    sections: [],
    images: [],
    section_images: [],
    scout_postcard_links: [],
  };
  /** Every write, in order: [op, table]. */
  log: [string, string][] = [];
  /** Make the next write matching op+table fail with this error. */
  failNext: { op: string; table: string; error: { code?: string; message: string } } | null = null;

  from(table: string) {
    return new Builder(this, table);
  }

  rpc(): Promise<Result> {
    return Promise.resolve({ data: [], error: null });
  }

  cascadeDelete(table: string, rows: Row[]) {
    if (table !== "images") return;
    const ids = new Set(rows.map((r) => r.id));
    this.tables.scout_postcard_links = this.tables.scout_postcard_links.filter((l) => !ids.has(l.image_id));
    this.tables.section_images = this.tables.section_images.filter((l) => !ids.has(l.image_id));
  }
}

class Builder implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private preds: ((r: Row) => boolean)[] = [];
  private payload: Row[] = [];
  private patch: Row = {};
  private lim: number | null = null;
  private sortBy: { col: string; asc: boolean } | null = null;
  private mode: "many" | "single" | "maybe" = "many";

  constructor(private db: FakeDb, private table: string) {}

  select() {
    return this;
  }
  insert(rows: Row | Row[]) {
    this.op = "insert";
    this.payload = (Array.isArray(rows) ? rows : [rows]).map((r) => ({ ...r }));
    return this;
  }
  update(patch: Row) {
    this.op = "update";
    this.patch = patch;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.preds.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.preds.push((r) => vals.includes(r[col]));
    return this;
  }
  not() {
    return this;
  }
  filter(col: string, _op: string, val: unknown) {
    const [base, key] = col.split("->>");
    this.preds.push((r) => r[base]?.[key] === val);
    return this;
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.sortBy = { col, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  private run(): Result {
    const rows = this.db.tables[this.table];
    const fail = this.db.failNext;
    if (fail && fail.op === this.op && fail.table === this.table) {
      this.db.failNext = null;
      return { data: null, error: fail.error };
    }
    if (this.op === "insert") {
      for (const r of this.payload) {
        if (!r.id && this.table !== "section_images" && this.table !== "scout_postcard_links") r.id = newId();
        if (this.table === "sections" && r.created_at === undefined) r.created_at = new Date().toISOString();
        for (const key of UNIQUE[this.table] ?? []) {
          const k = key(r);
          if (k && rows.some((x) => key(x) === k)) {
            return { data: null, error: { code: "23505", message: `duplicate key ${k}` } };
          }
        }
      }
      rows.push(...this.payload);
      this.db.log.push(["insert", this.table]);
      return this.shape(this.payload);
    }
    let hit = rows.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === "update") {
      for (const r of hit) Object.assign(r, this.patch);
      this.db.log.push(["update", this.table]);
      return { data: null, error: null };
    }
    if (this.op === "delete") {
      this.db.tables[this.table] = rows.filter((r) => !hit.includes(r));
      this.db.cascadeDelete(this.table, hit);
      this.db.log.push(["delete", this.table]);
      return { data: null, error: null };
    }
    if (this.sortBy) {
      const { col, asc } = this.sortBy;
      hit = [...hit].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1));
    }
    if (this.lim != null) hit = hit.slice(0, this.lim);
    return this.shape(hit);
  }

  private shape(rows: Row[]): Result {
    if (this.mode === "many") return { data: rows, error: null };
    if (rows.length === 0) {
      return this.mode === "maybe" ? { data: null, error: null } : { data: null, error: { message: "no rows" } };
    }
    return { data: rows[0], error: null };
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    bad?: ((e: unknown) => B | PromiseLike<B>) | null
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(ok, bad);
  }
}
