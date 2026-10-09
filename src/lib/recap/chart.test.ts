import { describe, it, expect } from "vitest";
import { buildHourChart, timingBars, dayLabel } from "./chart";
import { OKTANE_RECAP } from "./fixtures";

describe("buildHourChart", () => {
  const chart = buildHourChart(OKTANE_RECAP);

  it("draws one line per shooting day and never bridges the night", () => {
    expect(chart.days.map((d) => d.label)).toEqual(["Tue 22", "Wed 23", "Thu 24"]);
    expect(chart.linePaths).toHaveLength(3);
    expect(chart.days.reduce((n, d) => n + d.points.length, 0)).toBe(22);
  });

  it("draws shooting days only; a re-send a week later still counts but is not a day", () => {
    expect(OKTANE_RECAP.hours).toHaveLength(24);
    expect(OKTANE_RECAP.hours.reduce((n, h) => n + h.sent, 0)).toBe(OKTANE_RECAP.linksSent);
    expect(buildHourChart({ ...OKTANE_RECAP, firstCapture: null }).days).toHaveLength(5);
  });

  it("keeps every point inside the drawing", () => {
    for (const d of chart.days)
      for (const p of d.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(chart.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(chart.baseline);
      }
  });

  it("names the busiest hour as the one label", () => {
    expect(chart.peak?.sent).toBe(59);
    expect(chart.peak?.startsAt).toBe("2026-09-24T10:00:00-07:00");
    expect(chart.peak?.y).toBeCloseTo(26, 0);
  });

  it("labels the day from the local date, whatever zone the test runs in", () => {
    expect(dayLabel("2026-09-22")).toBe("Tue 22");
  });
});

describe("timingBars", () => {
  it("splits the measured links into three shares that sum to one", () => {
    const bars = timingBars(OKTANE_RECAP);
    expect(bars.map((b) => b.count)).toEqual([394, 195, 32]);
    expect(bars.reduce((n, b) => n + b.share, 0)).toBeCloseTo(1, 6);
  });

  it("is empty when nothing could be timed", () => {
    expect(
      timingBars({ ...OKTANE_RECAP, lastFrameToSend: { ...OKTANE_RECAP.lastFrameToSend, measured: 0 } })
    ).toEqual([]);
  });
});
