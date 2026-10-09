import { describe, it, expect } from "vitest";
import { dateRange } from "./dates";
import { OKTANE_RECAP } from "./fixtures";

const at = (first: string, last: string, tz = "America/Los_Angeles") => ({
  ...OKTANE_RECAP,
  timezone: tz,
  firstCapture: first,
  lastCapture: last,
});

describe("dateRange", () => {
  it("prints a run of days inside one month", () => {
    expect(dateRange(OKTANE_RECAP, null)).toBe("Sep 22–24, 2026");
    // WebexOne: Oct 6 to 8 local. The first deploy printed "Oct 6–2026 (Day: 8)".
    expect(dateRange(at("2026-10-06T19:01:42Z", "2026-10-08T21:30:29Z"), null)).toBe("Oct 6–8, 2026");
  });

  it("crosses a month boundary in the event's zone, not UTC", () => {
    // AAOMS: Oct 1 00:32 UTC is Sep 30 local; the first deploy read "Sep 30–2, 2026".
    expect(dateRange(at("2026-10-01T00:32:28Z", "2026-10-02T23:33:39Z"), null)).toBe("Sep 30 – Oct 2, 2026");
  });

  it("handles one day, a year boundary, and no captures", () => {
    expect(dateRange(at("2026-10-06T19:00:00Z", "2026-10-06T23:00:00Z"), null)).toBe("Oct 6, 2026");
    expect(dateRange(at("2026-12-30T19:00:00Z", "2027-01-02T19:00:00Z"), null)).toBe("Dec 30, 2026 – Jan 2, 2027");
    expect(dateRange(null, "2026-10-16")).toBe("Oct 16, 2026");
    expect(dateRange(null, null)).toBeNull();
  });
});
