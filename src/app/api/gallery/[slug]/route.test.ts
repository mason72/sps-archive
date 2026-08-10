import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Hermetic guest-payload test. The point of interest is share SCOPE: a share
 * type no reader knows how to narrow ("section", "person") must serve nothing
 * rather than the whole event, and it must not even reach the images table.
 *
 * Every assertion below is paired with a full-share control — a 404 test on a
 * harness that 404s everything would prove nothing.
 */

type QueryOp = { fn: string; args: unknown[] };

const db = {
  /** Row returned for .from("shares"). */
  share: null as Record<string, unknown> | null,
  /** Every table touched, in order. */
  tables: [] as string[],
  /** Ops recorded per table (last query wins for repeated tables). */
  ops: {} as Record<string, QueryOp[]>,
};

const IMAGE_ROWS = [
  {
    id: "img-1",
    r2_key: "events/e1/img-1.jpg",
    original_filename: "DSC_0001.jpg",
    parsed_name: null,
    width: 4000,
    height: 3000,
    aesthetic_score: 0.8,
    taken_at: null,
    dominant_color: "#aabbcc",
    media_type: "image",
    focal_x: null,
    focal_y: null,
  },
];

function resolveQuery(table: string, ops: QueryOp[]) {
  const isSingle = ops.some((o) => o.fn === "single" || o.fn === "maybeSingle");
  if (table === "shares") {
    return db.share
      ? { data: db.share, error: null }
      : { data: null, error: { message: "not found" } };
  }
  if (table === "events") {
    return {
      // user_id null keeps branding/activity-log out of this test's way.
      data: { name: "Test Event", event_date: null, user_id: null, settings: {} },
      error: null,
    };
  }
  if (table === "images") {
    // Paginated loop: rows on the first page, empty after, or the loop spins.
    const range = ops.find((o) => o.fn === "range");
    const offset = (range?.args[0] as number) ?? 0;
    return { data: offset === 0 ? IMAGE_ROWS : [], error: null };
  }
  return { data: isSingle ? null : [], error: null };
}

function makeBuilder(table: string) {
  const ops: QueryOp[] = [];
  db.ops[table] = ops;
  const chain: Record<string, unknown> = {};
  return new Proxy(chain, {
    get(_target, prop) {
      const name = String(prop);
      // The route awaits some builders directly (paginated selects) and calls
      // .single() on others — support both.
      if (name === "then") {
        return (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve(resolveQuery(table, ops)).then(onFulfilled, onRejected);
      }
      if (name === "single" || name === "maybeSingle") {
        return async () => {
          ops.push({ fn: name, args: [] });
          return resolveQuery(table, ops);
        };
      }
      return (...args: unknown[]) => {
        ops.push({ fn: name, args });
        return proxy;
      };
    },
  }) as never as Record<string, never> & { [k: string]: never };
}

let proxy: unknown;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      db.tables.push(table);
      proxy = makeBuilder(table);
      return proxy;
    },
    rpc: async () => ({ data: null, error: null }),
  }),
}));

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  // after() needs a request scope that vitest has no way to provide.
  return { ...actual, after: (fn: () => unknown) => void fn };
});

vi.mock("@/lib/r2/client", () => ({
  getPresignedDownloadUrl: async (key: string) => `https://r2.test/${key}`,
  getCachedThumbnailUrl: async (key: string) => `https://r2.test/${key}`,
  getCachedDownloadUrl: async (key: string) => `https://r2.test/${key}`,
  getThumbnailKey: (key: string) => `thumb/${key}`,
  getDisplayKey: (key: string) => `display/${key}`,
}));

vi.mock("@/lib/cover/payload", () => ({
  coverGalleryFields: async () => ({ coverEnabled: false }),
}));

vi.mock("@/lib/analytics/log", () => ({ logActivity: () => {} }));

import { GET } from "./route";

const baseShare = {
  id: "share-1",
  event_id: "event-1",
  slug: "abc123",
  is_active: true,
  expires_at: null,
  password_hash: null,
  custom_message: null,
  allow_download: true,
  allow_favorites: true,
  require_pin_bulk: false,
  require_pin_individual: false,
  share_type: "full",
  image_ids: null as string[] | null,
};

const call = () =>
  GET(new NextRequest("https://app.test/api/gallery/abc123"), {
    params: Promise.resolve({ slug: "abc123" }),
  });

describe("GET /api/gallery/[slug] — share scope", () => {
  beforeEach(() => {
    db.share = null;
    db.tables = [];
    db.ops = {};
  });

  it("serves the event's images for a full share", async () => {
    db.share = { ...baseShare };
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.images).toHaveLength(1);
    expect(body.images[0].id).toBe("img-1");
  });

  it("serves nothing for a section share, and never reads images", async () => {
    db.share = { ...baseShare, share_type: "section" };
    const res = await call();
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.images).toBeUndefined();
    // The whole point: no unfiltered whole-event query is even issued.
    expect(db.tables).not.toContain("images");
  });

  it("serves nothing for a person share", async () => {
    db.share = { ...baseShare, share_type: "person", image_ids: ["img-1"] };
    const res = await call();

    expect(res.status).toBe(404);
    expect(db.tables).not.toContain("images");
  });

  it("narrows a selection share to its own image ids", async () => {
    db.share = { ...baseShare, share_type: "selection", image_ids: ["img-1"] };
    const res = await call();

    expect(res.status).toBe(200);
    const inOp = db.ops.images?.find((o) => o.fn === "in");
    expect(inOp?.args).toEqual(["id", ["img-1"]]);
  });

  it("serves nothing for a selection share with an empty id list", async () => {
    db.share = { ...baseShare, share_type: "selection", image_ids: [] };
    const res = await call();

    expect(res.status).toBe(404);
    expect(db.tables).not.toContain("images");
  });
});
