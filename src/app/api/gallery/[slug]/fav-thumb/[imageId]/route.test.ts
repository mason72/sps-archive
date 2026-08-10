import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * fav-thumb serves a real image, and its only authorization used to be "a
 * favorites row exists for this share." That row has two writers (the guest
 * endpoint and the photographer's Pick in /api/images/batch), so the reader
 * has to check the share's scope itself.
 */

const db = {
  share: null as Record<string, unknown> | null,
  /** image_id of the favorite row that exists, if any. */
  favoritedImageId: null as string | null,
  tables: [] as string[],
};

function resolveQuery(table: string) {
  if (table === "shares") {
    return db.share ? { data: db.share, error: null } : { data: null, error: { message: "x" } };
  }
  if (table === "favorites") {
    return db.favoritedImageId
      ? {
          data: {
            image_id: db.favoritedImageId,
            images: { r2_key: `events/e1/${db.favoritedImageId}.jpg` },
          },
          error: null,
        }
      : { data: null, error: null };
  }
  return { data: null, error: null };
}

function makeBuilder(table: string) {
  const proxy: unknown = new Proxy({} as Record<string, unknown>, {
    get(_t, prop) {
      const name = String(prop);
      if (name === "then") {
        return (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
          Promise.resolve(resolveQuery(table)).then(onF, onR);
      }
      if (name === "single" || name === "maybeSingle") {
        return async () => resolveQuery(table);
      }
      return () => proxy;
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      db.tables.push(table);
      return makeBuilder(table);
    },
  }),
}));

vi.mock("@/lib/r2/client", () => ({
  getPresignedDownloadUrl: async (key: string) => `https://r2.test/${key}`,
  getThumbnailKey: (key: string) => `thumb/${key}`,
}));

import { GET } from "./route";

const call = (imageId: string) =>
  GET(new NextRequest(`https://app.test/api/gallery/abc/fav-thumb/${imageId}`), {
    params: Promise.resolve({ slug: "abc", imageId }),
  });

const baseShare = {
  id: "share-1",
  expires_at: null,
  share_type: "full",
  image_ids: null as string[] | null,
};

describe("GET /api/gallery/[slug]/fav-thumb/[imageId]", () => {
  beforeEach(() => {
    db.share = null;
    db.favoritedImageId = null;
    db.tables = [];
  });

  it("serves a favorited image on a full share", async () => {
    db.share = { ...baseShare };
    db.favoritedImageId = "img-1";

    const res = await call("img-1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("img-1");
  });

  it("serves a favorited image that is inside a selection share's scope", async () => {
    db.share = { ...baseShare, share_type: "selection", image_ids: ["img-1"] };
    db.favoritedImageId = "img-1";

    const res = await call("img-1");
    expect(res.status).toBe(302);
  });

  // The photographer's "Pick" can create a favorite row; before the scope
  // check, that row alone made the thumbnail public to anyone with the slug.
  it("refuses a favorited image OUTSIDE a selection share's scope", async () => {
    db.share = { ...baseShare, share_type: "selection", image_ids: ["img-1"] };
    db.favoritedImageId = "img-2";

    const res = await call("img-2");
    expect(res.status).toBe(404);
    // Rejected on the share alone — the favorite row is never consulted.
    expect(db.tables).not.toContain("favorites");
  });

  it("refuses everything on a section share", async () => {
    db.share = { ...baseShare, share_type: "section" };
    db.favoritedImageId = "img-1";

    const res = await call("img-1");
    expect(res.status).toBe(404);
    expect(db.tables).not.toContain("favorites");
  });

  it("still 404s a non-favorited image on a full share", async () => {
    db.share = { ...baseShare };
    db.favoritedImageId = null;

    const res = await call("img-1");
    expect(res.status).toBe(404);
  });
});
