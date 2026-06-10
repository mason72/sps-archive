import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Hermetic PATCH route test — fake auth + a minimal images builder that
// records update payloads, so validation and column mapping can be asserted.

const captured: { updates: Record<string, unknown>[]; owner: string } = {
  updates: [],
  owner: "u1",
};

vi.mock("@/lib/auth/helpers", () => ({
  getAuthUser: async () => ({
    user: { id: "u1" },
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: { id: "img-1", events: { user_id: captured.owner } },
              error: null,
            }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          captured.updates.push(payload);
          return {
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: "img-1",
                    focal_x: payload.focal_x ?? null,
                    focal_y: payload.focal_y ?? null,
                    service: payload.service ?? null,
                    featured: payload.featured ?? false,
                  },
                  error: null,
                }),
              }),
            }),
          };
        },
      }),
    },
    error: null,
  }),
}));

vi.mock("@/lib/r2/client", () => ({
  getPresignedDownloadUrl: async (key: string) => `https://r2.test/${key}`,
  getThumbnailKey: (key: string) => `thumb/${key}`,
  getDisplayKey: (key: string) => `display/${key}`,
}));

import { PATCH } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("https://app.test/api/images/img-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ imageId: "img-1" }) };

describe("PATCH /api/images/[imageId]", () => {
  beforeEach(() => {
    captured.updates = [];
    captured.owner = "u1";
  });

  it("updates service and featured with the right columns", async () => {
    const res = await PATCH(
      makeRequest({ service: "photo-booth", featured: true }),
      params
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(captured.updates[0]).toEqual({
      service: "photo-booth",
      featured: true,
    });
    expect(body.service).toBe("photo-booth");
    expect(body.featured).toBe(true);
  });

  it("clears service with null", async () => {
    const res = await PATCH(makeRequest({ service: null }), params);
    expect(res.status).toBe(200);
    expect(captured.updates[0]).toEqual({ service: null });
  });

  it("rejects a service outside the scene registry", async () => {
    const res = await PATCH(makeRequest({ service: "weddings" }), params);
    expect(res.status).toBe(400);
    expect(captured.updates).toHaveLength(0);
  });

  it("rejects a non-boolean featured", async () => {
    const res = await PATCH(makeRequest({ featured: "yes" }), params);
    expect(res.status).toBe(400);
  });

  it("rejects an empty body", async () => {
    const res = await PATCH(makeRequest({}), params);
    expect(res.status).toBe(400);
  });

  it("still accepts focal updates alongside the new fields", async () => {
    const res = await PATCH(
      makeRequest({ focalX: 40, focalY: 25.5, featured: false }),
      params
    );
    expect(res.status).toBe(200);
    expect(captured.updates[0]).toEqual({
      focal_x: 40,
      focal_y: 25.5,
      featured: false,
    });
  });

  it("returns 404 for an image the user does not own", async () => {
    captured.owner = "someone-else";
    const res = await PATCH(makeRequest({ featured: true }), params);
    expect(res.status).toBe(404);
    expect(captured.updates).toHaveLength(0);
  });
});
