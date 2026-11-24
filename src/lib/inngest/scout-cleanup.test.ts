import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ rows: [] as { id: string }[], error: null as null | { message: string }, asked: [] as string[] }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (_c: string, v: string) => {
          db.asked.push(v);
          return { limit: async () => ({ data: db.error ? null : db.rows, error: db.error }) };
        },
      }),
    }),
  }),
}));
const deleted = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/r2/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/r2/client")>();
  return { ...real, deleteFromR2: vi.fn(async (k: string) => void deleted.push(k)) };
});
// Capture the handler instead of registering it with a real Inngest client.
const captured = vi.hoisted(() => ({ handler: null as null | ((ctx: unknown) => Promise<unknown>) }));
vi.mock("./client", () => ({
  inngest: {
    createFunction: (_cfg: unknown, _trigger: unknown, handler: (ctx: unknown) => Promise<unknown>) => {
      captured.handler = handler;
      return { handler };
    },
  },
}));

import "./scout-cleanup";
import { clipKeys } from "@/lib/scout-integration/clip-keys";

const EVENT = "11111111-1111-4111-8111-111111111111";
const IMAGE = "22222222-2222-4222-8222-222222222222";
const step = { sleep: vi.fn(async () => {}), run: vi.fn(async (_n: string, fn: () => unknown) => fn()) };
const run = (data: Record<string, unknown>) => captured.handler!({ event: { data }, step });

beforeEach(() => {
  db.rows = [];
  db.error = null;
  db.asked = [];
  deleted.length = 0;
  step.sleep.mockClear();
});

describe("scout-clip-cleanup", () => {
  it("waits past the upload URLs, then deletes every key the attempt could have written", async () => {
    await run({ eventId: EVENT, imageId: IMAGE, sleepSeconds: 360 });
    expect(step.sleep).toHaveBeenCalledWith("wait-past-upload-urls", "360s");
    const k = clipKeys(EVENT, IMAGE);
    expect(deleted.sort()).toEqual([k.stagedKey, k.r2Key, ...k.posterKeys].sort());
    expect(k.stagedKey).toBe(`scout-staging/${EVENT}/${IMAGE}.mp4`);
  });

  it("touches nothing when a row uses the clip (a filed clip is never cleaned away)", async () => {
    db.rows = [{ id: IMAGE }];
    const out = await run({ eventId: EVENT, imageId: IMAGE, sleepSeconds: 360 });
    expect(out).toMatchObject({ skipped: expect.any(String) });
    expect(db.asked).toEqual([clipKeys(EVENT, IMAGE).r2Key]);
    expect(deleted).toEqual([]);
  });

  it("deletes nothing when the database cannot answer (it retries instead)", async () => {
    db.error = { message: "504" };
    await expect(run({ eventId: EVENT, imageId: IMAGE, sleepSeconds: 360 })).rejects.toBeTruthy();
    expect(deleted).toEqual([]);
  });

  it("derives its keys: a non-uuid id can never point it at other objects", async () => {
    await expect(run({ eventId: "../../other", imageId: IMAGE, sleepSeconds: 360 })).rejects.toThrow(/uuid/);
    expect(deleted).toEqual([]);
  });
});
