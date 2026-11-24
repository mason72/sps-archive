import { describe, expect, it } from "vitest";

// stats.ts imports next/server's after(), which needs no request context to load.
import { STATS_FRESH_MS, cacheState, parseStoredStats } from "./stats";

const NOW = Date.parse("2026-11-24T20:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("cacheState", () => {
  it("serves a row younger than the window as fresh", () => {
    expect(cacheState(ago(STATS_FRESH_MS - 1), NOW, false)).toBe("fresh");
  });

  it("serves a row at or past the window as stale", () => {
    expect(cacheState(ago(STATS_FRESH_MS), NOW, false)).toBe("stale");
    expect(cacheState(ago(24 * 60 * 60 * 1000), NOW, false)).toBe("stale");
  });

  it("treats no row as a miss", () => {
    expect(cacheState(null, NOW, false)).toBe("miss");
  });

  it("treats a forced read as a miss even when the row is fresh", () => {
    expect(cacheState(ago(1000), NOW, true)).toBe("miss");
  });

  it("does not vouch for a timestamp it cannot read", () => {
    expect(cacheState("not a date", NOW, false)).toBe("miss");
  });
});

describe("parseStoredStats", () => {
  const good = { totalEvents: 1473, totalImages: 1676685, totalViews: 9, totalFavorites: 0 };

  it("reads a complete row", () => {
    expect(parseStoredStats(good)).toEqual(good);
  });

  it("drops extra keys", () => {
    expect(parseStoredStats({ ...good, computedAt: "x" })).toEqual(good);
  });

  it("rejects a row missing any number, so it is recounted instead of shown short", () => {
    const short: Record<string, number> = { ...good };
    delete short.totalFavorites;
    expect(parseStoredStats(short)).toBeNull();
  });

  it("rejects NaN, negatives, fractions and strings", () => {
    expect(parseStoredStats({ ...good, totalImages: Number.NaN })).toBeNull();
    expect(parseStoredStats({ ...good, totalViews: -1 })).toBeNull();
    expect(parseStoredStats({ ...good, totalEvents: 1.5 })).toBeNull();
    expect(parseStoredStats({ ...good, totalImages: "12" })).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(parseStoredStats(null)).toBeNull();
    expect(parseStoredStats("{}")).toBeNull();
  });
});
