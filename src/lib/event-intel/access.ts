/**
 * Who is Event Intel FOR — the one gate.
 *
 * ── The problem this closes ──
 *
 * Mason, 2026-08-15: "Import from SPS should be available to all PT users but
 * none of the calendar matching, intel sheets, etc."
 *
 * He is right, and it was worse than dead UI. `GOOGLE_CALENDAR_KEY` is ONE
 * service account reading a HARDCODED set of Two Dudes Photo calendars
 * (`CALENDARS` in google-calendar.ts) — it is a studio-owned resource, not a
 * per-user connection the way the SPS token is. `/api/events/suggest-gig`
 * checked THAT you were signed in and never WHO you were, so any Pixeltrunk
 * account typing in the event-name box received Two Dudes' gig titles, venue
 * addresses, client domains and — via `unresolvedCrew` — attendee EMAIL
 * ADDRESSES. Not hypothetical: there is a third alpha account
 * (mwalker721@gmail.com, a person on the roster) that signed in on 2026-08-10.
 *
 * Contrast with the SPS import, which is correctly available to everyone: that
 * one runs on `sps_connections`, a credential each user pastes for their own
 * SPS account, so it can only ever reach their own events.
 *
 * ── Why an explicit id list, and not `is_admin` ──
 *
 * MEASURED before choosing, and the measurement inverted the obvious answer.
 * Every crew row (86), venue (17), organisation (12), event (44) and intel row
 * (22) belongs to **info@twodudesphoto.com**, the shared team login — while
 * `is_admin` belongs ONLY to mason@ and never to info@ (docs/OPS.md, on
 * purpose). Gating on admin would have handed Intel to the account with no data
 * and denied it to the account with all of it.
 *
 * A list rather than one id because Two Dudes has two logins, and the studio is
 * the unit here, not the person.
 *
 * ── It fails CLOSED ──
 *
 * No config means nobody, which is the correct direction: the failure is Mason
 * seeing Intel disappear (loud, one env var away from fixed), never another
 * account seeing his crew. Same rule as the production-fallback one in
 * ship-discipline.md — a missing dependency is an outage, not a default-open.
 *
 * ── This is INTERIM, and the shape it becomes is already in the codebase ──
 *
 * Mason, 2026-08-15: "at some point we may enable this feature to users but
 * they will need to connect their own calendars and create their own rosters
 * and such."
 *
 * That is the SPS model exactly — `sps_connections` holds one credential per
 * user, minted by them, and is why the import is safe for everybody today. The
 * end state is a `calendar_connections` row per user and this function becoming
 * "does this account have a calendar connected", with the crew, venue and
 * organisation registries needing no change at all (they are already per-user
 * tables; the roster is only Two Dudes' because Two Dudes is who filled it in).
 *
 * So the id list is the interim answer to a question whose long-term answer is
 * a table, and swapping it is this one function. Keep every caller asking
 * `hasIntelAccess(userId)` and nothing else has to move.
 *
 * ── This is not the only boundary ──
 *
 * Every registry read is ALSO scoped by `user_id`, because `getAuthUser()`
 * hands back the service client and RLS is bypassed. This gate hides a feature;
 * the ownership filters are what make the data safe. Neither replaces the other.
 */

/** The accounts Event Intel belongs to, from config. Empty means nobody. */
export function intelOwnerIds(): string[] {
  return (process.env.EVENT_INTEL_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is this account allowed to see crew, venues, clients and the calendar? */
export function hasIntelAccess(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return intelOwnerIds().includes(userId);
}

/**
 * The 403 body every gated Intel route returns.
 *
 * Deliberately says the feature is not enabled rather than "forbidden": for
 * every other account this is not a permission they could be granted, it is a
 * feature that is not theirs, and a 403 reading like a mistake invites support
 * questions about a door that does not exist.
 */
export const INTEL_DISABLED = {
  error: "Event Intel is not enabled for this account.",
  reason: "intel-not-enabled" as const,
};
