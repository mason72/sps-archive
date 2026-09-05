import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  IMAGE_DOWNLOAD_MAX,
  IMAGE_DOWNLOAD_WINDOW_SECONDS,
} from "@/lib/security/rate-limit";

/**
 * Hermetic test of the presign budget on image-download. The authorizer and
 * the image lookup are stubbed to "yes"; the rate-limit RPC is a faithful
 * in-memory copy of record_auth_attempt (migration 026): fixed window, one
 * counter per key, `attempts <= p_max`. What is under test is the WIRING —
 * that the route asks, with which key and budget, in which order relative to
 * authorization — and that the budget itself lets a whole legitimate gallery
 * through while stopping a script.
 */

const rpc = {
  calls: [] as { key: string; max: number; window: number }[],
  counters: new Map<string, number>(),
  /** Simulate an infrastructure failure on the RPC. */
  error: null as { message: string } | null,
};

type AuthResult =
  | { ok: true; share: { id: string } }
  | { ok: false; status: number; message: string };
const authorize = vi.fn<() => Promise<AuthResult>>(async () => ({
  ok: true,
  share: { id: "share-1" },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    rpc: async (
      _fn: string,
      args: { p_key: string; p_max: number; p_window_seconds: number }
    ) => {
      rpc.calls.push({ key: args.p_key, max: args.p_max, window: args.p_window_seconds });
      if (rpc.error) return { data: null, error: rpc.error };
      const n = (rpc.counters.get(args.p_key) ?? 0) + 1;
      rpc.counters.set(args.p_key, n);
      return { data: n <= args.p_max, error: null };
    },
  }),
}));

vi.mock("@/lib/gallery/download-core", () => ({
  authorizeShareDownload: (...args: unknown[]) => authorize(...(args as [])),
  selectShareImage: async (_db: unknown, _share: unknown, imageId: string) => ({
    id: imageId,
    r2_key: `events/e1/${imageId}.jpg`,
    original_filename: "DSC_0001.jpg",
  }),
}));

vi.mock("@/lib/r2/client", () => ({
  getPresignedDownloadUrl: async (key: string) => `https://r2.test/${key}`,
}));

vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: async () => {} }));

import { POST } from "./route";

const IMAGE_ID = "11111111-1111-4111-8111-111111111111";

const call = (ip = "203.0.113.7") =>
  POST(
    new NextRequest("https://app.test/api/gallery/abc123/image-download", {
      method: "POST",
      body: JSON.stringify({ imageId: IMAGE_ID, dt: "token" }),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    }),
    { params: Promise.resolve({ slug: "abc123" }) }
  );

describe("POST /api/gallery/[slug]/image-download — presign budget", () => {
  beforeEach(() => {
    rpc.calls = [];
    rpc.counters.clear();
    rpc.error = null;
    authorize.mockClear();
    authorize.mockImplementation(async () => ({ ok: true, share: { id: "share-1" } }));
  });

  it("counts against a per-(slug, ip) key with the image-download budget", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(rpc.calls).toEqual([
      {
        key: "image-download:abc123:203.0.113.7",
        max: IMAGE_DOWNLOAD_MAX,
        window: IMAGE_DOWNLOAD_WINDOW_SECONDS,
      },
    ]);
  });

  it("the largest curated share in production (50 images) goes through untouched", async () => {
    // Largest curated share measured in production: 50 images.
    for (let i = 0; i < 50; i++) expect((await call()).status).toBe(200);
    expect(rpc.counters.get("image-download:abc123:203.0.113.7")).toBe(50);
  });

  it("request MAX passes and request MAX+1 is a 429 with no presign", async () => {
    for (let i = 0; i < IMAGE_DOWNLOAD_MAX; i++) {
      expect((await call()).status).toBe(200);
    }
    const blocked = await call();
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.downloadUrl).toBeUndefined();
    expect(body.error).toMatch(/too many downloads/i);
  });

  it("the budget is per IP: another guest on the same gallery is unaffected", async () => {
    for (let i = 0; i <= IMAGE_DOWNLOAD_MAX; i++) await call("203.0.113.7");
    expect((await call("203.0.113.7")).status).toBe(429);
    expect((await call("198.51.100.9")).status).toBe(200);
  });

  it("is checked AFTER authorization: a rejected request spends no budget", async () => {
    authorize.mockImplementation(async () => ({
      ok: false,
      status: 401,
      message: "Authentication required",
    }));
    const res = await call();
    expect(res.status).toBe(401);
    expect(rpc.calls).toHaveLength(0);
  });

  it("fails OPEN on limiter infrastructure errors, matching the other scopes", async () => {
    rpc.error = { message: "connection refused" };
    expect((await call()).status).toBe(200);
  });
});
