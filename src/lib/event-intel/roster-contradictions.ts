/**
 * Where the roster CLAIMS one thing and the linked data SHOWS another.
 *
 * ── Why this exists ──
 *
 * Joey Nagoshiner — a founder, and the most-booked name in the archive at 13
 * linked gigs — spent two weeks in Non-regulars, and was rated `last_resort`
 * only because he was sitting in the bench being rated. Nothing was broken.
 * `is_regular` is a manual star that is **false by default** on insert, the
 * 2026-08-15 marking pass simply missed him, and nobody audits 87 rows by eye.
 *
 * The contradiction was a single query the whole time: a non-regular with more
 * gigs than any regular. Twice as many, in fact. The information to catch this
 * was sitting in the same tables the roster already reads.
 *
 * ── It is a REGRESSION guard, not a cleanup tool ──
 *
 * Measured on the live roster the day it was written: **zero hits.** Replayed
 * against Joey's pre-fix state it fires immediately ("13 gigs vs best regular
 * 6"). So there is no backlog here; the entire value is catching the next
 * person who ends up mis-filed. Do not let a future empty result read as a
 * broken probe — `scripts/triage/roster-contradictions.ts` replays the Joey
 * fixture precisely so "no hits" stays distinguishable from "not working".
 *
 * ── Pure, and computed from data the caller already has ──
 *
 * `GET /api/crew` already loads every crew row AND every `event_crew` link, to
 * produce the per-person event counts and the derived last-hired date. So these
 * checks cost no extra query — they are a second reading of a pass that was
 * already happening. Kept pure and separate from the route so the fixture test
 * can drive it without a database.
 */

export interface ContradictionInput {
  id: string;
  display_name: string;
  is_regular: boolean;
  archived: boolean;
  rehire: string | null;
  /** How many events they are linked to. */
  eventCount: number;
  /** The newest linked event date, ISO or null. */
  latestEvent: string | null;
}

export interface RosterContradiction {
  crewId: string;
  name: string;
  /** One sentence, in the words the roster uses. Names the evidence. */
  message: string;
}

/** A year, in days — "still working" for someone marked as gone. */
const RECENT_DAYS = 365;

export function findRosterContradictions(
  people: ContradictionInput[],
  now: Date = new Date()
): RosterContradiction[] {
  const out: RosterContradiction[] = [];
  const active = people.filter((p) => !p.archived);

  /**
   * The busiest ACTIVE regular is the bar. Deliberately `>=` rather than `>`:
   * a non-regular merely TYING your most-booked regular is already the
   * question worth asking, and Joey cleared the bar by more than double.
   *
   * Skipped entirely when no regular has a single gig — with no bar, every
   * non-regular clears it and the check would flag the whole roster. An
   * unusable answer is worse than none.
   */
  const bestRegular = Math.max(
    0,
    ...active.filter((p) => p.is_regular).map((p) => p.eventCount)
  );
  if (bestRegular > 0) {
    for (const p of active) {
      if (p.is_regular || p.eventCount < bestRegular) continue;
      out.push({
        crewId: p.id,
        name: p.display_name,
        message:
          `is not marked a regular, but has ${p.eventCount} gigs — ` +
          `as many as your busiest regular (${bestRegular}).`,
      });
    }
  }

  for (const p of active) {
    /**
     * Regulars are not rated — "you do not file a rehire judgement on your own
     * team", and the rebook control only renders for non-regulars. So a rating
     * on a regular is DORMANT: invisible in the UI, still stored, and it comes
     * back the day someone unstars them. That is exactly the trap Joey's
     * `last_resort` would have become had it only been hidden rather than
     * cleared.
     */
    if (p.is_regular && p.rehire) {
      out.push({
        crewId: p.id,
        name: p.display_name,
        message:
          p.rehire === "never"
            ? `is a regular and also marked never hire again — those cannot both be true.`
            : `is a regular carrying a hidden “${p.rehire.replace(/_/g, " ")}” rating ` +
              `from before they were starred. It is invisible here but would come back if they were ever unstarred.`,
      });
    }
  }

  const cutoff = new Date(now.getTime() - RECENT_DAYS * 86_400_000);
  for (const p of people) {
    if (!p.archived || !p.latestEvent) continue;
    if (new Date(p.latestEvent) < cutoff) continue;
    out.push({
      crewId: p.id,
      name: p.display_name,
      message: `is in Alumni but worked a gig on ${p.latestEvent}.`,
    });
  }

  return out;
}
