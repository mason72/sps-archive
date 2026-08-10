import { describe, it, expect } from "vitest";
import { relativeTime, lastViewedLabel } from "./last-viewed";

const agoISO = (mins: number) =>
  new Date(Date.now() - mins * 60_000).toISOString();

describe("relativeTime", () => {
  it("counts up through minutes, hours and days", () => {
    expect(relativeTime(agoISO(0))).toBe("Just now");
    expect(relativeTime(agoISO(5))).toBe("5m ago");
    expect(relativeTime(agoISO(60 * 3))).toBe("3h ago");
    expect(relativeTime(agoISO(60 * 24 * 4))).toBe("4d ago");
  });

  it("switches to a date once a day count stops being useful", () => {
    const old = agoISO(60 * 24 * 400);
    expect(relativeTime(old)).toBe(new Date(old).toLocaleDateString());
    expect(relativeTime(old)).not.toContain("d ago");
  });
});

describe("lastViewedLabel", () => {
  it("says Never only when nothing has viewed the share", () => {
    expect(lastViewedLabel(0, null)).toBe("Never");
  });

  it("never contradicts a non-zero view count", () => {
    // The bug: views counted before migration 039 carry no timestamp, and
    // "12 views · Never" is a flat contradiction.
    expect(lastViewedLabel(12, null)).toBe("Unknown");
    expect(lastViewedLabel(443, null)).not.toBe("Never");
  });

  it("reports the real time once a view has been stamped", () => {
    expect(lastViewedLabel(1, agoISO(5))).toBe("5m ago");
  });
});
