import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/scout-integration/client-bts", () => ({
  listClientGalleries: vi.fn(async () => [{ event_id: "e", name: "Acme", date: "2026-11-20", client_name: null, match: "date" }]),
  placeInClientGallery: vi.fn(async (_db: unknown, _p: string, e: string) => ({ ok: true, event_id: e, section_id: "s" })),
  removeFromClientGallery: vi.fn(async () => {
    const { ScoutIntegrationError } = await import("@/lib/scout-integration/store");
    throw new ScoutIntegrationError("No such postcard in Pixeltrunk.", 404);
  }),
}));
vi.mock("@/lib/scout-integration/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/scout-integration/store")>();
  return { ...real, scoutDb: vi.fn(() => ({})) };
});
vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

import { GET } from "./route";
import { PUT, DELETE } from "../postcards/[postcardId]/client/route";
import { listClientGalleries } from "@/lib/scout-integration/client-bts";

const KEY = "client-route-key-0123456789";
const PID = "3f2a9c1e-0b7d-4e7a-9a51-2c4d6e8f0a1b";
const EVT = "00000000-0000-4000-8000-0000000000c1";
const req = (url: string, init: RequestInit = {}, key: string | null = KEY) =>
  new Request(`https://app.test${url}`, { ...init, headers: { ...(key ? { "X-Scout-Key": key } : {}), "Content-Type": "application/json" } });
const ctx = { params: Promise.resolve({ postcardId: PID }) };

beforeEach(() => {
  process.env.SCOUT_INTEGRATION_KEY = KEY;
  vi.mocked(listClientGalleries).mockClear();
});
afterEach(() => {
  delete process.env.SCOUT_INTEGRATION_KEY;
});

describe("GET /client-galleries", () => {
  it("answers { candidates } and passes the window through", async () => {
    const res = await GET(req("/api/integrations/scout/client-galleries?date=2026-11-20&days=2&calendar_event_id=cal1_x"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ candidates: [expect.objectContaining({ event_id: "e", match: "date" })] });
    expect(vi.mocked(listClientGalleries).mock.calls[0][1]).toEqual({ date: "2026-11-20", days: 2, calendarEventId: "cal1_x" });
  });

  it("is 401 without the key and 400 for a bad date or days", async () => {
    expect((await GET(req("/x?date=2026-11-20&days=1", {}, null))).status).toBe(401);
    for (const q of ["date=2026-13-01&days=1", "date=2026-11-20&days=0", "date=2026-11-20&days=32", "date=2026-11-20&days=1.5"]) {
      expect((await GET(req(`/x?${q}`))).status, q).toBe(400);
    }
    expect(listClientGalleries).not.toHaveBeenCalled();
  });
});

describe("PUT / DELETE /postcards/:id/client", () => {
  it("PUT answers { ok, event_id, section_id }", async () => {
    const res = await PUT(req("/x", { method: "PUT", body: JSON.stringify({ event_id: EVT }) }), ctx);
    expect(await res.json()).toEqual({ ok: true, event_id: EVT, section_id: "s" });
  });

  it("PUT is 400 without a uuid event_id", async () => {
    for (const body of [{}, { event_id: "nope" }, { event_id: 3 }]) {
      expect((await PUT(req("/x", { method: "PUT", body: JSON.stringify(body) }), ctx)).status).toBe(400);
    }
  });

  it("DELETE of a postcard Pixeltrunk never had is { removed: false }, not an error", async () => {
    const res = await DELETE(req("/x", { method: "DELETE" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: false });
  });
});
