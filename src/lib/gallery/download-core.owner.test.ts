import { describe, it, expect, beforeEach } from "vitest";
import { selectOwnerImages } from "./download-core";

/**
 * The editor's selection ZIP runs on the SERVICE client, so the ownership
 * filter inside `selectOwnerImages` is the only thing between one user's
 * session and another user's originals (the IDOR this repo shipped twice).
 * A recording fake: the `events` lookup answers from a tiny table and the
 * test asserts the filter it was asked for, so a build that drops the
 * `user_id` eq goes red here before it goes live.
 */
type Op = { fn: string; args: unknown[] };
const EVENTS = [
  { id: "ev-a", name: "WebexOne 2026", user_id: "owner-a" },
  { id: "ev-b", name: "Someone Else", user_id: "owner-b" },
];
const IMAGES = [
  { id: "11111111-1111-4111-8111-111111111111", event_id: "ev-a", r2_key: "a/1.jpg", original_filename: "Pramod_1.jpg", file_size: 100 },
  { id: "22222222-2222-4222-8222-222222222222", event_id: "ev-a", r2_key: "a/2.jpg", original_filename: "Pramod_2.jpg", file_size: 200 },
  { id: "33333333-3333-4333-8333-333333333333", event_id: "ev-b", r2_key: "b/3.jpg", original_filename: "Other.jpg", file_size: 300 },
  { id: "44444444-4444-4444-8444-444444444444", event_id: "ev-a", r2_key: null, original_filename: "ghost.jpg", file_size: 0 },
];
const seen: Record<string, Op[]> = {};

function resolve(table: string, ops: Op[]) {
  const eqs = Object.fromEntries(ops.filter((o) => o.fn === "eq").map((o) => [o.args[0] as string, o.args[1]]));
  if (table === "events") {
    const row = EVENTS.find((e) => Object.entries(eqs).every(([k, v]) => (e as Record<string, unknown>)[k] === v));
    return { data: row ?? null, error: null };
  }
  if (table === "images") {
    const inOp = ops.find((o) => o.fn === "in");
    const ids = new Set((inOp?.args[1] as string[]) ?? []);
    const rows = IMAGES.filter(
      (i) => Object.entries(eqs).every(([k, v]) => (i as Record<string, unknown>)[k] === v) && ids.has(i.id) && i.r2_key !== null
    ).map((i) => ({ id: i.id, r2_key: i.r2_key, original_filename: i.original_filename, file_size: i.file_size }));
    return { data: rows, error: null };
  }
  return { data: null, error: { message: `unexpected table ${table}` } };
}

function fakeSupabase() {
  return {
    from(table: string) {
      const ops: Op[] = [];
      seen[table] = ops;
      const q: Record<string, unknown> = {};
      const chain = (fn: string) => (...args: unknown[]) => { ops.push({ fn, args }); return q; };
      for (const fn of ["select", "eq", "in", "not", "order", "range"]) q[fn] = chain(fn);
      q.maybeSingle = () => Promise.resolve(resolve(table, ops));
      q.single = q.maybeSingle;
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(resolve(table, ops)).then(res, rej);
      return q;
    },
  } as unknown as Parameters<typeof selectOwnerImages>[0];
}

const A1 = IMAGES[0].id, A2 = IMAGES[1].id, B3 = IMAGES[2].id, GHOST = IMAGES[3].id;

describe("selectOwnerImages — the editor's selection ZIP is owner-scoped", () => {
  beforeEach(() => { for (const k of Object.keys(seen)) delete seen[k]; });

  it("hands the owner their own photos, in the order the editor showed them", async () => {
    const r = await selectOwnerImages(fakeSupabase(), "owner-a", "ev-a", [A2, A1], "Pramod");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images.map((i) => i.id)).toEqual([A2, A1]);
    expect(r.totalBytes).toBe(300);
    expect(r.zipFilename).toBe("WebexOne-2026-Pramod.zip");
    // The events lookup carried the ownership filter — the whole point.
    expect(seen.events.filter((o) => o.fn === "eq").map((o) => o.args)).toEqual(
      expect.arrayContaining([["id", "ev-a"], ["user_id", "owner-a"]])
    );
  });

  it("answers 404 for an event the user does not own, even with valid ids", async () => {
    const r = await selectOwnerImages(fakeSupabase(), "owner-a", "ev-b", [B3]);
    expect(r).toEqual({ ok: false, status: 404, message: "Event not found" });
    expect(seen.images).toBeUndefined();
  });

  it("drops another event's ids and rows with no bytes from a mixed request", async () => {
    const r = await selectOwnerImages(fakeSupabase(), "owner-a", "ev-a", [A1, B3, GHOST, "not-a-uuid"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.images.map((i) => i.id)).toEqual([A1]);
  });

  it("refuses an empty or all-junk selection before touching the database", async () => {
    const r = await selectOwnerImages(fakeSupabase(), "owner-a", "ev-a", ["junk"]);
    expect(r).toEqual({ ok: false, status: 400, message: "No photos selected" });
    expect(seen.events).toBeUndefined();
  });
});
