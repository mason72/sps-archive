import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Hermetic route test — no Supabase or R2. The query builders resolve to two
// fake curated membership rows so the 200 path (ordering, slot semantics,
// focal fields, Cache-Control) can be asserted.
//
// rowA: featured, drag order 1 — pool scenes return it FIRST (featured wins).
// rowB: not featured, drag order 0 — slot scenes return ONLY it (drag order
// wins, extras ignored).
vi.mock("@/lib/supabase/server", () => {
  const rowA = {
    sort_order: 1,
    images: {
      id: "img-a",
      r2_key: "events/e1/originals/a.jpg",
      width: 4000,
      height: 6000,
      service: "photo-booth",
      featured: true,
      created_at: "2026-01-02T00:00:00Z",
      focal_x: 33.3,
      focal_y: 25,
      events: { name: "Test Event", city: "Seattle" },
    },
  };
  const rowB = {
    sort_order: 0,
    images: {
      id: "img-b",
      r2_key: "events/e1/originals/b.jpg",
      width: 3000,
      height: 2000,
      service: null,
      featured: false,
      created_at: "2026-01-01T00:00:00Z",
      focal_x: null,
      focal_y: null,
      events: { name: "Other Event", city: "Portland" },
    },
  };

  function builder(result: unknown) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "not", "order"]) {
      b[m] = vi.fn(() => b);
    }
    b.maybeSingle = vi.fn(() =>
      Promise.resolve({ data: { id: "sec-1" }, error: null })
    );
    b.then = (resolve: (v: unknown) => void) =>
      resolve({ data: result, error: null });
    return b;
  }

  return {
    createServiceClient: () => ({
      from: (table: string) =>
        table === "sections" ? builder(null) : builder([rowA, rowB]),
    }),
  };
});

vi.mock("@/lib/r2/public-lane", () => ({
  getPublicLaneUrl: (key: string) => `https://cdn.test/${key}`,
}));

import { GET } from "./route";

const TEST_KEY = "test-integration-key";

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest("https://app.test/api/site/scene/hero", { headers });
}

function makeParams(key: string[] = ["hero"]) {
  return { params: Promise.resolve({ key }) };
}

describe("GET /api/site/scene/[...key]", () => {
  beforeEach(() => {
    vi.stubEnv("SPS_INTEGRATION_KEY", TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when X-SPS-Key is missing", async () => {
    const res = await GET(makeRequest(), makeParams());
    expect(res.status).toBe(401);
  });

  it("returns 401 when X-SPS-Key is wrong", async () => {
    const res = await GET(
      makeRequest({ "x-sps-key": "wrong-key" }),
      makeParams()
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 when SPS_INTEGRATION_KEY is not configured, even with a key", async () => {
    vi.stubEnv("SPS_INTEGRATION_KEY", "");
    const res = await GET(
      makeRequest({ "x-sps-key": "anything" }),
      makeParams()
    );
    expect(res.status).toBe(401);
  });

  it("returns the pool scene featured-first with the v1 fields plus focal", async () => {
    const res = await GET(
      makeRequest({ "x-sps-key": TEST_KEY }),
      makeParams()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scene).toBe("hero");
    expect(body.count).toBe(2);
    // Featured beats drag order in pools.
    expect(body.images.map((i: { id: string }) => i.id)).toEqual([
      "img-a",
      "img-b",
    ]);
    // Contract: v1 fields unchanged…
    expect(body.images[0]).toMatchObject({
      id: "img-a",
      event: "Test Event",
      city: "Seattle",
      service: "photo-booth",
      featured: true,
      width: 4000,
      height: 6000,
    });
    expect(body.images[0].thumbUrl).toMatch(/^https:\/\/cdn\.test\//);
    expect(body.images[0].fullUrl).toMatch(/^https:\/\/cdn\.test\//);
    // …plus the v2 focal point (null when unset).
    expect(body.images[0].focalX).toBe(33.3);
    expect(body.images[0].focalY).toBe(25);
    expect(body.images[1].focalX).toBeNull();
    expect(body.images[1].focalY).toBeNull();
  });

  it("returns ordered scenes in exact drag order — featured does not jump the queue", async () => {
    const res = await GET(
      makeRequest({ "x-sps-key": TEST_KEY }),
      makeParams(["benefits", "photo-booth"])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // Position-mapped: image N fills position N, so a featured boost would
    // scramble the page. img-b (drag order 0) must come first even though
    // img-a is featured — and nothing is truncated.
    expect(body.count).toBe(2);
    expect(body.images.map((i: { id: string }) => i.id)).toEqual([
      "img-b",
      "img-a",
    ]);
  });

  it("returns only the first image (by drag order) for slot scenes", async () => {
    const res = await GET(
      makeRequest({ "x-sps-key": TEST_KEY }),
      makeParams(["slot", "slice-1"])
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scene).toBe("slot/slice-1");
    expect(body.count).toBe(1);
    // Drag order wins in slots — featured does not jump the queue.
    expect(body.images[0].id).toBe("img-b");
    // No implied service on the image or a non-service slice? slice-1 implies
    // headshot-booth, which fills the read-time fallback for img-b's null.
    expect(body.images[0].service).toBe("headshot-booth");
  });

  it("never marks the authenticated 200 as shared-cacheable", async () => {
    // Regression: `public, s-maxage` let Vercel's edge cache (which doesn't
    // key on X-SPS-Key) replay the authenticated 200 to unauthenticated
    // requests, bypassing the 401 above entirely.
    const res = await GET(
      makeRequest({ "x-sps-key": TEST_KEY }),
      makeParams()
    );
    const cacheControl = res.headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("private");
    expect(cacheControl).not.toContain("public");
    expect(cacheControl).not.toContain("s-maxage");
  });

  it("returns 404 for an unknown scene (authenticated)", async () => {
    const res = await GET(
      makeRequest({ "x-sps-key": TEST_KEY }),
      makeParams(["not-a-scene"])
    );
    expect(res.status).toBe(404);
  });
});
