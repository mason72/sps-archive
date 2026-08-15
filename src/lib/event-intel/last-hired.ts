/**
 * "How long ago did we last work with them?" — one derivation, one format.
 *
 * Mason, 2026-08-15: "Last Hired In; this should be a combination of month and
 * year, e.g. Aug 2024 (2 yrs)... it should update any time they work an event.
 * For anyone less than 1 yr ago, we can just say (Recent)."
 *
 * The effective date is max(hand-entered seed, newest linked event) — derived
 * at READ time, never written on event-link, because a stored copy would need
 * every path that links crew to remember to bump it, and the one that forgot
 * would go stale invisibly. Deriving makes "updates any time they work an
 * event" true by construction.
 *
 * Non-regulars only, by his words — your own team is not something you track a
 * last-hire date for. Callers enforce that; these functions just compute.
 */

/**
 * The best "last hired" date we can claim, as an ISO date string.
 *
 * `stored` is the hand-entered seed (crew.last_hired_on). `eventDates` are the
 * dates of events this person is LINKED to — event_date when the event has
 * one, else the event's created date (an import or upload happens days after
 * the shoot at most, which is well inside month resolution).
 */
export function effectiveLastHired(
  stored: string | null | undefined,
  eventDates: (string | null | undefined)[]
): string | null {
  let best: string | null = null;
  for (const d of [stored, ...eventDates]) {
    const day = (d ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!best || day > best) best = day;
  }
  return best;
}

/**
 * "Aug 2024 (2 yrs)" — or "Jun 2026 (Recent)" inside a year.
 *
 * Whole months between the two dates, floored to years for the suffix. The
 * month label always shows: "(Recent)" replaces the AGE, not the date —
 * knowing it was June still matters in April.
 */
export function formatLastHired(iso: string | null, now: Date): string | null {
  if (!iso || !/^\d{4}-\d{2}/.test(iso)) return null;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (month < 1 || month > 12) return null;

  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

  const monthsAgo = (now.getUTCFullYear() - year) * 12 + (now.getUTCMonth() + 1 - month);
  if (monthsAgo < 12) return `${label} (Recent)`;
  const years = Math.floor(monthsAgo / 12);
  return `${label} (${years} yr${years === 1 ? "" : "s"})`;
}

/** The month-input round trip: "2024-08" → "2024-08-01", junk → null. */
export function monthToDate(input: unknown): string | null {
  const v = String(input ?? "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? `${v}-01` : null;
}
