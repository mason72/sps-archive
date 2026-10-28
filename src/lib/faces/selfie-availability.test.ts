import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/monitoring/report", () => ({ reportSystemError: vi.fn(async () => {}) }));

import {
  DETECTOR_WARM_FOR_MS,
  detectorRecentlyUsed,
  eventHasFaces,
  selfieSearchAvailable,
} from "./selfie-availability";

/** A query chain that records its calls and resolves to one canned answer. */
function fakeDb(answer: { data: unknown[] | null; error: unknown }) {
  const calls: { table: string; ops: [string, unknown[]][] } = { table: "", ops: [] };
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gte", "limit"]) {
    chain[op] = (...args: unknown[]) => {
      calls.ops.push([op, args]);
      return op === "limit" ? Promise.resolve(answer) : chain;
    };
  }
  const db = {
    from: (table: string) => {
      calls.table = table;
      return chain;
    },
  };
  return { db: db as never, calls };
}

describe("eventHasFaces", () => {
  it("is true when a photo with a face exists, and asks images by event", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "i1", faces: [{ id: "f1" }] }], error: null });
    expect(await eventHasFaces(db, "ev1")).toBe(true);
    expect(calls.table).toBe("images");
    expect(calls.ops).toContainEqual(["select", ["id, faces!inner(id)"]]);
    expect(calls.ops).toContainEqual(["eq", ["event_id", "ev1"]]);
  });

  it("is false for a gallery with no faces", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(await eventHasFaces(db, "ev1")).toBe(false);
  });

  it("is TRUE when the read fails: unknown is not 'no faces'", async () => {
    const { db } = fakeDb({ data: null, error: { message: "timeout" } });
    expect(await eventHasFaces(db, "ev1")).toBe(true);
  });
});

describe("selfieSearchAvailable", () => {
  it("is off without a database read when the owner switched it off", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "i1" }], error: null });
    expect(await selfieSearchAvailable(db, "ev1", { selfieSearch: false })).toBe(false);
    expect(calls.table).toBe("");
  });

  it("is on by default when the gallery has faces", async () => {
    const { db } = fakeDb({ data: [{ id: "i1" }], error: null });
    expect(await selfieSearchAvailable(db, "ev1", {})).toBe(true);
    expect(await selfieSearchAvailable(db, "ev1", null)).toBe(true);
  });

  it("is off when the toggle is on but the gallery has no faces", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(await selfieSearchAvailable(db, "ev1", { selfieSearch: true })).toBe(false);
  });
});

describe("detectorRecentlyUsed", () => {
  it("looks for a selfie-endpoint row inside the warm window", async () => {
    const now = Date.parse("2026-10-28T20:00:00Z");
    const { db, calls } = fakeDb({ data: [{ id: "u1" }], error: null });
    expect(await detectorRecentlyUsed(db, now)).toBe(true);
    expect(calls.table).toBe("usage_events");
    expect(calls.ops).toContainEqual(["eq", ["kind", "ai_embed_selfie"]]);
    expect(calls.ops).toContainEqual([
      "gte",
      ["created_at", new Date(now - DETECTOR_WARM_FOR_MS).toISOString()],
    ]);
  });

  it("is false with no recent row, and false on a failed read (a ping is cheap)", async () => {
    expect(await detectorRecentlyUsed(fakeDb({ data: [], error: null }).db)).toBe(false);
    expect(
      await detectorRecentlyUsed(fakeDb({ data: null, error: { message: "x" } }).db)
    ).toBe(false);
  });
});
