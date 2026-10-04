import { describe, expect, it } from "vitest";
import {
  FaceInsertOutOfTime,
  insertInShrinkingChunks,
  isStatementTimeout,
  type DbError,
} from "./face-insert";

const TIMEOUT: DbError = {
  message: "canceling statement due to statement timeout",
  code: "57014",
};

const rows = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("isStatementTimeout", () => {
  it("matches the Postgres code and the message", () => {
    expect(isStatementTimeout(TIMEOUT)).toBe(true);
    expect(isStatementTimeout({ message: "canceling statement due to statement timeout" })).toBe(true);
  });
  it("does not match other failures or no failure", () => {
    expect(isStatementTimeout({ message: "duplicate key", code: "23505" })).toBe(false);
    expect(isStatementTimeout(null)).toBe(false);
  });
});

describe("insertInShrinkingChunks", () => {
  it("sends fixed chunks on a healthy database", async () => {
    const sizes: number[] = [];
    const out = await insertInShrinkingChunks(rows(120), async (slice) => {
      sizes.push(slice.length);
      return null;
    });
    expect(sizes).toEqual([50, 50, 20]);
    expect(out).toEqual({ statements: 3, shrinks: 0, finalChunk: 50 });
  });

  it("halves on a timeout and lands every row exactly once", async () => {
    // The 2026-10-04 shape: anything over 12 rows is too slow to finish.
    const landed: number[] = [];
    const out = await insertInShrinkingChunks(rows(100), async (slice) => {
      if (slice.length > 12) return TIMEOUT;
      landed.push(...slice);
      return null;
    });
    expect(landed).toEqual(rows(100));
    expect(out.shrinks).toBe(2); // 50 -> 25 -> 12
    expect(out.finalChunk).toBe(12);
  });

  it("keeps the smaller chunk for the rest of the batch", async () => {
    const sizes: number[] = [];
    let first = true;
    await insertInShrinkingChunks(rows(100), async (slice) => {
      sizes.push(slice.length);
      if (first) {
        first = false;
        return TIMEOUT;
      }
      return null;
    });
    expect(sizes).toEqual([50, 25, 25, 25, 25]);
  });

  it("throws the timeout once the floor cannot fit", async () => {
    const sizes: number[] = [];
    await expect(
      insertInShrinkingChunks(rows(100), async (slice) => {
        sizes.push(slice.length);
        return TIMEOUT;
      })
    ).rejects.toBe(TIMEOUT);
    expect(sizes).toEqual([50, 25, 12, 6, 5]);
  });

  it("throws any other error without retrying", async () => {
    const other: DbError = { message: "duplicate key", code: "23505" };
    let calls = 0;
    await expect(
      insertInShrinkingChunks(rows(100), async () => {
        calls++;
        return other;
      })
    ).rejects.toBe(other);
    expect(calls).toBe(1);
  });

  it("starts at the chunk the previous batch ended on", async () => {
    const sizes: number[] = [];
    const out = await insertInShrinkingChunks(
      rows(30),
      async (slice) => {
        sizes.push(slice.length);
        return null;
      },
      { startChunk: 12 }
    );
    expect(sizes).toEqual([12, 12, 6]);
    expect(out.finalChunk).toBe(12);
  });

  it("stops at the deadline instead of running past it, and says how far it got", async () => {
    let now = 1_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const landed: number[] = [];
      await expect(
        insertInShrinkingChunks(
          rows(100),
          async (slice) => {
            landed.push(...slice);
            now += 400; // each statement takes 400 ms
            return null;
          },
          { startChunk: 10, deadline: 2_000 }
        )
      ).rejects.toBeInstanceOf(FaceInsertOutOfTime);
      // 1000 -> 1400 -> 1800 -> 2200: the fourth statement is never started.
      expect(landed).toEqual(rows(30));
    } finally {
      Date.now = realNow;
    }
  });

  it("cannot loop forever on a zero or unreadable chunk size", async () => {
    const sizes: number[] = [];
    await insertInShrinkingChunks(
      rows(3),
      async (slice) => {
        sizes.push(slice.length);
        return null;
      },
      { startChunk: Number.NaN, minChunk: 0 }
    );
    expect(sizes).toEqual([3]);
    const one: number[] = [];
    await insertInShrinkingChunks(
      rows(2),
      async (slice) => {
        one.push(slice.length);
        return null;
      },
      { startChunk: 0, minChunk: 0 }
    );
    expect(one.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it("does nothing for no rows", async () => {
    let calls = 0;
    const out = await insertInShrinkingChunks([], async () => {
      calls++;
      return null;
    });
    expect(calls).toBe(0);
    expect(out.statements).toBe(0);
  });
});
