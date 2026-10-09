import type { SpsRecap } from "./types";

/**
 * The hero's date line, from the capture window in the event's zone:
 * "Oct 6–8, 2026", "Sep 30 – Oct 2, 2026", "Dec 30, 2026 – Jan 2, 2027", or
 * "Oct 6, 2026" for one day. Falls back to `events.event_date` when the
 * recap has no captures.
 */
export function dateRange(recap: SpsRecap | null, fallback: string | null): string | null {
  const first = recap?.firstCapture ?? fallback;
  const last = recap?.lastCapture ?? fallback ?? first;
  if (!first || !last) return null;
  const tz = recap?.timezone ?? "America/Los_Angeles";
  // Assembled from parts: asking Intl for "day and year" alone prints
  // "2026 (day: 8)", which is what the first tablet screenshot showed.
  const parts = (d: string) => {
    // A bare DATE ("2026-10-16", events.event_date) names a calendar day and
    // formats in UTC; a timestamp formats in the event's zone (GOTCHAS).
    const zone = /^\d{4}-\d{2}-\d{2}$/.test(d) ? "UTC" : tz;
    const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "short", day: "numeric", year: "numeric" }).formatToParts(new Date(d));
    const get = (type: string) => p.find((x) => x.type === type)?.value ?? "";
    return { month: get("month"), day: get("day"), year: get("year") };
  };
  const a = parts(first);
  const b = parts(last);
  if (a.month === b.month && a.day === b.day && a.year === b.year) return `${a.month} ${a.day}, ${a.year}`;
  if (a.month === b.month && a.year === b.year) return `${a.month} ${a.day}–${b.day}, ${a.year}`;
  if (a.year === b.year) return `${a.month} ${a.day} – ${b.month} ${b.day}, ${a.year}`;
  return `${a.month} ${a.day}, ${a.year} – ${b.month} ${b.day}, ${b.year}`;
}

