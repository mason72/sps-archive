import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Hermetic route test — no Supabase or R2. The query builder resolves to one
// fake curated row so the 200 path (and its Cache-Control) can be asserted.
vi.mock("@/lib/supabase/server", () => {
  const row = {
    id: "img-1",
    r2_key: "events/e1/originals/a.jpg",
    width: 4000,
    height: 6000,
    service: "photo-booth",
    featured: true,
    events: { name: "Test Event", city: "Seattle" },
  };
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: (resolve: (v: { data: unknown[]; error: null }) => void) =>
      resolve({ data: [row], error: null }),
  };
  return { createServiceClient: () => ({ from: () => builder }) };
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

describe("GET /api/site/scene/[...key] auth", () => {
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

  it("returns 200 with the curated scene for the correct key", async () => {
    const res = await GET(
      makeRequest({ "x-sps-key": TEST_KEY }),
      makeParams()
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scene).toBe("hero");
    expect(body.count).toBe(1);
    expect(body.images[0].thumbUrl).toMatch(/^https:\/\/cdn\.test\//);
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
