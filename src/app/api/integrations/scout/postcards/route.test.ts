import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/scout-integration/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/scout-integration/store")>();
  return {
    ...real,
    scoutDb: vi.fn(() => ({})),
    ingestPostcard: vi.fn(async () => ({
      link: { image_id: "img-1" },
      created: true,
      status: "ready",
      aiIndexRequested: null,
    })),
  };
});
vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { ingestPostcard } from "@/lib/scout-integration/store";
import { POST } from "./route";

const KEY = "route-test-key-0123456789";
const body = {
  postcard_id: "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b",
  gig_id: "gig-1",
  gig_title: "Acme",
  image_url: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/poster.jpg",
  media_type: "video",
  video_url: "https://ezubznenjcogwocccznj.supabase.co/storage/v1/object/sign/p/clip.mp4",
  duration_s: 12,
};

beforeEach(() => {
  process.env.SCOUT_INTEGRATION_KEY = KEY;
});
afterEach(() => {
  delete process.env.SCOUT_INTEGRATION_KEY;
});

describe("POST /api/integrations/scout/postcards", () => {
  it("hands the store the moment the request ARRIVED, so the clip budget counts the whole request", async () => {
    const before = Date.now();
    const res = await POST(
      new Request("https://app.test/api/integrations/scout/postcards", {
        method: "POST",
        headers: { "X-Scout-Key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
    expect(res.status).toBe(201);
    const opts = vi.mocked(ingestPostcard).mock.calls[0][2];
    expect(typeof opts?.startedAt).toBe("number");
    expect(opts!.startedAt!).toBeGreaterThanOrEqual(before);
    expect(opts!.startedAt!).toBeLessThanOrEqual(Date.now());
  });
});
