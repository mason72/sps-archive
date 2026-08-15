/**
 * Fetching calendar gigs for a live lookup — the create screen's data source.
 *
 * The backfill walks twelve years once. This walks a window on every few
 * keystrokes, which is a different cost problem, so two things matter here that
 * do not matter there:
 *
 *  1. A CACHE. Without one, a typed name is one Google round trip per
 *     debounce tick, and Google rate-limits by project. Keyed on the window and
 *     held briefly — a gig booked in the last five minutes is not a case worth
 *     paying for on every keystroke.
 *  2. A MISSING CREDENTIAL IS NOT AN ERROR HERE. The create screen has to keep
 *     working with no calendar at all; it just cannot suggest. It says so
 *     rather than rendering an empty list, because "no credential" and "no gig
 *     that day" look identical from the outside and only one of them is
 *     something Mason can fix.
 */
import { CALENDARS, STUDIO_CALENDARS, listEvents, type CalendarKey } from "./google-calendar";
import { groupIntoGigs, parseStudioSession } from "./parse-calendar";
import type { Gig } from "./match-gig";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; gigs: Gig[] }>();

export interface GigWindow {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date, exclusive-ish — passed straight to Google as timeMax. */
  to: string;
}

/**
 * The window to search, given whatever the create form knows so far.
 *
 * With a date, a tight window around it. Without one, a backward-looking window
 * that assumes the ordinary case: you are making the gallery for a job you just
 * shot. The forward reach is short but non-zero, because a gallery does
 * sometimes get set up the week before.
 */
export function windowFor(day: string | null | undefined, today: Date): GigWindow {
  const shift = (base: Date, days: number) =>
    new Date(base.getTime() + days * 86400000).toISOString().slice(0, 10);

  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const d = new Date(`${day}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return { from: shift(d, -10), to: shift(d, 10) };
  }
  return { from: shift(today, -240), to: shift(today, 45) };
}

/**
 * Every gig in a window, grouped, with studio sittings folded in.
 *
 * Studio bookings become single-entry pseudo-gigs rather than going through
 * `groupIntoGigs`: there is no crew segment for it to read, the "client" is a
 * person rather than a company, and two unrelated sittings on one afternoon
 * must never merge into one gig the way a set-up and its main day should.
 * Identical reasoning to the backfill — see `scripts/match-calendar.ts`.
 */
export async function fetchGigsInWindow({ from, to }: GigWindow): Promise<Gig[]> {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.gigs;

  const timeMin = `${from}T00:00:00Z`;
  const timeMax = `${to}T23:59:59Z`;

  const crewed = [];
  const studio = [];
  for (const cal of Object.keys(CALENDARS) as CalendarKey[]) {
    const evs = await listEvents(cal, { timeMin, timeMax });
    if (STUDIO_CALENDARS.has(cal)) studio.push(...evs);
    else crewed.push(...evs);
  }

  const gigs = groupIntoGigs(crewed);
  for (const e of studio) {
    const s = parseStudioSession(e);
    if (!s.isBooking || !s.clientName) continue;
    const day = (e.start?.date ?? e.start?.dateTime ?? "").slice(0, 10);
    if (!day) continue;
    gigs.push({ client: s.clientName, start: day, end: day, events: [e] });
  }

  cache.set(key, { at: Date.now(), gigs });
  return gigs;
}

/** Is a Google Calendar credential configured at all? */
export function hasCalendarCredential(): boolean {
  if (process.env.GOOGLE_CALENDAR_KEY) return true;
  if (process.env.GOOGLE_CALENDAR_KEY_FILE) return true;
  // The repo-local file is the local-dev path; checked lazily so this module
  // stays importable in environments with no filesystem access.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require("node:path") as typeof import("node:path");
    return existsSync(join(process.cwd(), ".google-calendar-key.json"));
  } catch {
    return false;
  }
}
