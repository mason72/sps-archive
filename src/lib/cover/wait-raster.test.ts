import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * waitForCoverRaster (2026-10-29): the email composer waits until the stored
 * raster matches the cover's CURRENT inputs, because Gmail keeps whichever
 * frame it fetches first.
 */
const heads: (Record<string, string> | null)[] = [];
const sent: unknown[] = [];

vi.mock("@/lib/r2/client", () => ({
  getObjectMetadata: vi.fn(async () => (heads.length ? heads.shift()! : null)),
  getPresignedDownloadUrl: vi.fn(),
  getThumbnailKey: vi.fn(),
  uploadToR2: vi.fn(),
}));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async (e: unknown) => { sent.push(e); }) } }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));

const SOLID = { enabled: true, type: "solid" } as never;
const FAST = { timeoutMs: 1_000, intervalMs: 5, headCapMs: 20 };

async function target() {
  const { coverInputsHash } = await import("./pool");
  const { sanitizeCoverForEvent } = await import("@/types/event-settings");
  return coverInputsHash(sanitizeCoverForEvent("e1", SOLID), []);
}

describe("waitForCoverRaster", () => {
  beforeEach(() => { heads.length = 0; sent.length = 0; });

  it("returns at once when the raster already matches", async () => {
    const { waitForCoverRaster } = await import("./pool");
    heads.push({ "inputs-hash": await target() });
    expect(await waitForCoverRaster("e1", SOLID, FAST)).toBe("fresh");
    expect(sent).toHaveLength(0);
  });

  it("waits while missing, asks for the build once, and ends on the matching raster", async () => {
    const { waitForCoverRaster } = await import("./pool");
    heads.push(null, null, { "inputs-hash": await target() });
    expect(await waitForCoverRaster("e1", SOLID, FAST)).toBe("fresh");
    expect(sent).toHaveLength(1);
  });

  it("a stale raster replaced by an IN-BETWEEN composition does not end the wait", async () => {
    const { waitForCoverRaster } = await import("./pool");
    // old, a failed read, an older overlapping run's output, then the real one
    heads.push({ "inputs-hash": "old" }, null, { "inputs-hash": "in-between" }, { "inputs-hash": await target() });
    expect(await waitForCoverRaster("e1", SOLID, FAST)).toBe("fresh");
    expect(heads).toHaveLength(0);
  });

  it("at the deadline, says what was last seen", async () => {
    const { waitForCoverRaster } = await import("./pool");
    for (let i = 0; i < 400; i++) heads.push({ "inputs-hash": "old" });
    expect(await waitForCoverRaster("e1", SOLID, { ...FAST, timeoutMs: 60 })).toBe("stale");
    heads.length = 0;
    expect(await waitForCoverRaster("e1", SOLID, { ...FAST, timeoutMs: 60 })).toBe("missing");
  });

  it("never starts a poll it cannot finish by the deadline", async () => {
    const { waitForCoverRaster } = await import("./pool");
    const t = Date.now();
    await waitForCoverRaster("e1", SOLID, { timeoutMs: 100, intervalMs: 40, headCapMs: 50 });
    expect(Date.now() - t).toBeLessThan(150);
  });
});
