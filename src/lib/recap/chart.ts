import { recapDays } from "./normalize";
import type { SpsRecap } from "./types";

/**
 * Geometry for the recap page's charts, kept pure so it can be tested
 * without a DOM. One scale per chart, never two axes.
 */

export interface HourPoint {
  x: number;
  y: number;
  sent: number;
  opened: number;
  startsAt: string;
}

export interface DayGroup {
  date: string;
  label: string;
  x0: number;
  x1: number;
  points: HourPoint[];
}

export interface HourChart {
  width: number;
  height: number;
  /** Plot area bottom (the baseline). */
  baseline: number;
  days: DayGroup[];
  /** The busiest hour, for the one direct label. */
  peak: HourPoint | null;
  maxSent: number;
  /** One SVG path per day (the line never bridges the night). */
  linePaths: string[];
  areaPaths: string[];
}

const DAY_LABEL = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });

/** "Tue 22" from a local-date string; the zone is already baked into it. */
export function dayLabel(date: string): string {
  // Assembled from parts: the locale's own order puts the number first.
  const parts = DAY_LABEL.formatToParts(new Date(`${date}T12:00:00Z`));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  return `${weekday} ${day}`.trim();
}

/**
 * The days the chart draws: those inside the capture window. A gallery
 * re-sent a week later is a real send (it counts toward linksSent) but a
 * single-point "day" on the chart, so the chart keeps to when the booth
 * was open. Without capture times every day is drawn.
 */
export function shootingDays(recap: SpsRecap) {
  const days = recapDays(recap);
  if (!recap.firstCapture || !recap.lastCapture) return days;
  const local = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: recap.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const first = local(recap.firstCapture);
  const last = local(recap.lastCapture);
  const inWindow = days.filter((d) => d.date >= first && d.date <= last);
  return inWindow.length ? inWindow : days;
}

export function buildHourChart(
  recap: SpsRecap,
  width = 640,
  height = 200,
  pad = { top: 26, bottom: 28, side: 20 }
): HourChart {
  const days = shootingDays(recap);
  const total = days.reduce((n, d) => n + d.hours.length, 0);
  const baseline = height - pad.bottom;
  const plotH = baseline - pad.top;
  const maxSent = Math.max(1, ...recap.hours.map((h) => h.sent));
  const gap = days.length > 1 ? 36 : 0;
  const innerW = width - pad.side * 2 - gap * (days.length - 1);
  const step = total > 1 ? innerW / (total - 1 + (days.length - 1) * 0) : innerW;

  let x = pad.side;
  let peak: HourPoint | null = null;
  const groups: DayGroup[] = [];
  const linePaths: string[] = [];
  const areaPaths: string[] = [];
  for (const d of days) {
    const points: HourPoint[] = [];
    const x0 = x;
    d.hours.forEach((h, i) => {
      const px = x0 + i * step;
      const py = baseline - (h.sent / maxSent) * plotH;
      const pt = { x: px, y: py, sent: h.sent, opened: h.opened, startsAt: h.startsAt };
      points.push(pt);
      if (!peak || h.sent > peak.sent) peak = pt;
    });
    const x1 = points.length ? points[points.length - 1].x : x0;
    groups.push({ date: d.date, label: dayLabel(d.date), x0, x1, points });
    if (points.length) {
      const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      linePaths.push(line);
      areaPaths.push(`${line} L${x1.toFixed(1)},${baseline} L${x0.toFixed(1)},${baseline} Z`);
    }
    x = x1 + step + gap;
  }

  return { width, height, baseline, days: groups, peak, maxSent, linePaths, areaPaths };
}

export interface TimingBar {
  label: string;
  count: number;
  share: number;
}

/**
 * Where the seconds went: under a minute, one to five, longer. Shares are of
 * the links SPS could time, so they sum to 1 when anything was measured.
 */
export function timingBars(recap: SpsRecap): TimingBar[] {
  const t = recap.lastFrameToSend;
  if (t.measured <= 0) return [];
  const under1 = t.under60s;
  const oneToFive = Math.max(0, t.under300s - t.under60s);
  const longer = Math.max(0, t.measured - t.under300s);
  return [
    { label: "Under a minute", count: under1, share: under1 / t.measured },
    { label: "1 to 5 minutes", count: oneToFive, share: oneToFive / t.measured },
    { label: "Longer", count: longer, share: longer / t.measured },
  ];
}
