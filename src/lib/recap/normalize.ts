import { RECAP_VERSION, type RecapHour, type SpsRecap } from "./types";

/**
 * The one parse point for a recap, wherever it was read from: the SPS
 * response, the `events.recap` column, a test fixture. Same role as
 * `normalizeCoverSettings` for covers. Anything malformed yields null rather
 * than a half-filled object, because a recap card with "undefined guests" in
 * a client's inbox is worse than no card.
 */

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function count(v: unknown): number {
  const n = num(v);
  return n !== null && n >= 0 ? Math.round(n) : 0;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

export function normalizeRecap(input: unknown): SpsRecap | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  if (r.version !== RECAP_VERSION) return null;
  const generatedAt = str(r.generatedAt);
  const eventName = str(r.eventName);
  if (!generatedAt || !eventName) return null;

  const timing = (r.lastFrameToSend ?? {}) as Record<string, unknown>;
  const hoursRaw = Array.isArray(r.hours) ? r.hours : [];
  const hours: RecapHour[] = [];
  for (const h of hoursRaw) {
    if (!h || typeof h !== "object") continue;
    const row = h as Record<string, unknown>;
    const startsAt = str(row.startsAt);
    if (!startsAt) continue;
    hours.push({ startsAt, sent: count(row.sent), opened: count(row.opened) });
  }
  hours.sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  return {
    version: RECAP_VERSION,
    generatedAt,
    timezone: str(r.timezone) ?? "America/Los_Angeles",
    eventName,
    firstCapture: str(r.firstCapture),
    lastCapture: str(r.lastCapture),
    guestsCheckedIn: count(r.guestsCheckedIn),
    photos: count(r.photos),
    aiRenders: count(r.aiRenders),
    linksSent: count(r.linksSent),
    recipients: count(r.recipients),
    linksOpened: count(r.linksOpened),
    totalOpens: count(r.totalOpens),
    lastFrameToSend: {
      medianSec: num(timing.medianSec),
      p90Sec: num(timing.p90Sec),
      under60s: count(timing.under60s),
      under300s: count(timing.under300s),
      measured: count(timing.measured),
    },
    hours,
  };
}

/**
 * Below this, the numbers stop being a story and the card stays out of the
 * email. A 12-person office headshot day is a fine job; "12 guests, 11 links,
 * 7 opened" is not something to lead a client email with. The recap page still
 * exists for the owner at any size.
 */
export const RECAP_FLOOR = { guests: 20, links: 20 } as const;

export function recapPassesFloor(recap: SpsRecap | null): recap is SpsRecap {
  return (
    !!recap &&
    recap.guestsCheckedIn >= RECAP_FLOOR.guests &&
    recap.linksSent >= RECAP_FLOOR.links
  );
}

/** Opened share of links sent, as a whole percent, or null when nothing was sent. */
export function recapOpenRate(recap: SpsRecap): number | null {
  if (recap.linksSent <= 0) return null;
  return Math.round((recap.linksOpened / recap.linksSent) * 100);
}

/**
 * The timing as a client reads it: "45 sec", "3 min", or null when SPS could
 * not measure it (SMS-only events have no frame-to-send pairs).
 */
export function formatSeconds(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec) || sec < 0) return null;
  if (sec < 90) return `${Math.round(sec)} sec`;
  const min = sec / 60;
  return min < 10 ? `${min.toFixed(1).replace(/\.0$/, "")} min` : `${Math.round(min)} min`;
}

/**
 * Deliveries per hour, with gaps between shooting days closed so a chart
 * reads as three day groups rather than one line with 14 idle hours of zeros.
 * Each day is the local calendar date of the bucket's `startsAt`.
 */
export function recapDays(recap: SpsRecap): { date: string; hours: RecapHour[] }[] {
  const days = new Map<string, RecapHour[]>();
  for (const h of recap.hours) {
    // `startsAt` keeps the owner's offset, so the first ten characters ARE the
    // local date — no second timezone conversion.
    const date = h.startsAt.slice(0, 10);
    const list = days.get(date) ?? [];
    list.push(h);
    days.set(date, list);
  }
  return [...days.entries()].map(([date, hours]) => ({ date, hours }));
}

/** The number a sentence leads with, as "704" or "5,119". */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}
