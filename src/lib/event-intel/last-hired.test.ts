import { describe, expect, it } from "vitest";
import { effectiveLastHired, formatLastHired, monthToDate } from "./last-hired";

// The clock is INJECTED — a test that reads the real date passes today and
// fails on the anniversary of its own writing.
const NOW = new Date("2026-08-15T12:00:00Z");

describe("effectiveLastHired — the newest of seed and linked events", () => {
  it("a linked event newer than the seed wins — 'updates any time they work'", () => {
    expect(effectiveLastHired("2024-08-01", ["2026-08-10", "2025-01-03"])).toBe("2026-08-10");
  });

  it("the seed wins when the links predate it — history Mason remembers", () => {
    expect(effectiveLastHired("2025-06-01", ["2018-05-02"])).toBe("2025-06-01");
  });

  it("timestamps are tolerated — created_at is a fallback date source", () => {
    expect(effectiveLastHired(null, ["2026-08-11T17:25:00.000Z"])).toBe("2026-08-11");
  });

  it("nothing known is null, not an invention", () => {
    expect(effectiveLastHired(null, [null, undefined, "garbage"])).toBeNull();
  });
});

describe("formatLastHired — Mason's exact format", () => {
  it("two years back reads Aug 2024 (2 yrs)", () => {
    expect(formatLastHired("2024-08-01", NOW)).toBe("Aug 2024 (2 yrs)");
  });

  it("inside a year the AGE becomes (Recent) but the month still shows", () => {
    expect(formatLastHired("2026-06-01", NOW)).toBe("Jun 2026 (Recent)");
    expect(formatLastHired("2025-09-01", NOW)).toBe("Sep 2025 (Recent)"); // 11 months
  });

  it("exactly 12 months is a year, singular", () => {
    expect(formatLastHired("2025-08-01", NOW)).toBe("Aug 2025 (1 yr)");
  });

  it("null in, null out", () => {
    expect(formatLastHired(null, NOW)).toBeNull();
  });
});

describe("monthToDate — the month input's round trip", () => {
  it("accepts what <input type=month> emits", () => {
    expect(monthToDate("2024-08")).toBe("2024-08-01");
  });
  it("refuses junk rather than storing it", () => {
    expect(monthToDate("2024-13")).toBeNull();
    expect(monthToDate("August 2024")).toBeNull();
    expect(monthToDate("")).toBeNull();
  });
});
