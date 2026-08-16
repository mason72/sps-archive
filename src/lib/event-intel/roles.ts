/**
 * What a role IS — the one home for the vocabulary and its shape rule.
 *
 * Mason, 2026-08-15: "lead is more of an on/off thing while photographer,
 * stylist, MUA is 'select one of these'." The first build modelled all six as
 * one free multi-select, which allowed stylist AND photographer — impossible on
 * a real gig, and enforced in the API rather than only the UI because a UI rule
 * is not a rule.
 *
 * "digital tech" is gone: it never named a person, only a shift. The pair trade
 * off across the day and both do both.
 *
 * This lives in its own file because there are now THREE writers — the event
 * page's Intel tab, the confirm strip under the photos, and the create screen —
 * and a vocabulary re-declared per call site is a vocabulary that splits into
 * Photographer / photographer / Photog.
 */

export const DISCIPLINES = ["photographer", "stylist", "makeup artist"] as const;
export const KNOWN_ROLES = ["lead", ...DISCIPLINES] as const;

/**
 * Normalise a role set to the model: at most one discipline, plus an optional
 * `lead` flag. Unknown words are dropped rather than stored — free text is how
 * a pivot silently splits.
 *
 * When several disciplines arrive the LAST wins, which is what a picker does
 * when you change your mind.
 */
export function cleanRoles(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const asked = [...new Set(input.map((r) => String(r).toLowerCase().trim()))].filter((r) =>
    (KNOWN_ROLES as readonly string[]).includes(r)
  );
  const disciplines = asked.filter((r) => (DISCIPLINES as readonly string[]).includes(r));
  return [
    ...(asked.includes("lead") ? ["lead"] : []),
    ...(disciplines.length ? [disciplines[disciplines.length - 1]] : []),
  ];
}

/**
 * The subset a human has endorsed.
 *
 * Confirmation follows the roles the caller SENT and nothing else. A role they
 * just switched on is confirmed; a guess they left alone stays a guess — still
 * in `roles`, still shown dashed, still excluded from any tally. That is the
 * fix for clicking "lead" on Joey and silently blessing the machine's opinion
 * that he was also the photographer.
 *
 * Always a subset of `roles`: a confirmation of something not on the gig is not
 * a fact, it is a stale click.
 */
export function cleanConfirmedRoles(input: unknown, roles: string[]): string[] {
  if (!Array.isArray(input)) return roles;
  return [...new Set(input.map((r) => String(r).toLowerCase().trim()))].filter(
    (r) => (KNOWN_ROLES as readonly string[]).includes(r) && roles.includes(r)
  );
}

// ── the rehire ladder ───────────────────────────────────────────────────────

/**
 * How eagerly would you book this person again?
 *
 * Mason, 2026-08-15: "can we come up with some sort of rating system so we can
 * quickly identify whether they were a solid hire or a last resort? This will be
 * helpful if we're looking for people in a particular area to rehire."
 *
 * ORDINAL, and in his words. The old field was `would_rebook` yes|maybe|no,
 * which collapses "I'd call them first" and "they were fine" into one "yes" —
 * losing precisely the distinction he asked for. Free to change: 0 of 40 crew
 * links carried a judgement, so there is nothing to migrate and nobody to
 * re-ask. The column has no CHECK constraint; this list is the only gate.
 *
 * Ordered best-to-worst on purpose, so "best available near this city" is a
 * sort rather than a special case.
 */
export const REHIRE_LADDER = ["first_call", "solid", "last_resort", "never"] as const;
export type Rehire = (typeof REHIRE_LADDER)[number];

export const REHIRE_LABEL: Record<Rehire, string> = {
  first_call: "First call",
  solid: "Solid",
  last_resort: "Last resort",
  never: "Never again",
};

/** Legacy yes|maybe|no, mapped forward so old rows keep meaning something. */
const LEGACY: Record<string, Rehire> = { yes: "solid", maybe: "last_resort", no: "never" };

export function cleanRehire(input: unknown): Rehire | null {
  const v = String(input ?? "").toLowerCase().trim();
  if (!v) return null;
  if ((REHIRE_LADDER as readonly string[]).includes(v)) return v as Rehire;
  return LEGACY[v] ?? null;
}

export interface RehireStanding {
  /** What to show, and what to sort on. Null when nobody has judged them. */
  headline: Rehire | null;
  /** How many of each, best-to-worst. */
  tally: Record<Rehire, number>;
  total: number;
  /**
   * True when a `never` exists ANYWHERE in their history, even if the latest
   * gig went fine.
   */
  hardNo: boolean;
  /**
   * True when the headline came from `crew.rehire` — a standing opinion someone
   * seeded — rather than from any rated gig. Said out loud so a seed never
   * renders as if it were earned from evidence.
   */
  fromBaseline: boolean;
}

/**
 * ⚠️ WHERE A STANDING MAY BE SHOWN — the anchoring rule.
 *
 * Mason, 2026-08-15: show ratings "wherever else they appear (e.g. on events
 * AFTER they've been rated to eliminate bias)".
 *
 * A person's standing is fine to show on /intel, on a roster picker, on a
 * staffing search — anywhere you are CHOOSING someone. It must NOT be visible
 * on the event where you are about to rate them, until that event's own rating
 * exists. Seeing "First call ×4" while deciding today's rating is a prompt to
 * agree with yourself, and the whole value of this data is that it is an
 * independent judgement per gig.
 *
 * So the gate is per-event and per-person: reveal the standing for someone on
 * an event only once `event_crew.would_rebook` for THAT event is non-null.
 * `standingVisibleFor()` below is the single expression of that; never re-derive
 * it at a call site.
 */
export function standingVisibleFor(thisEventRating: string | null | undefined): boolean {
  return cleanRehire(thisEventRating) !== null;
}

/**
 * Summarise a person's ratings — deliberately NOT an average.
 *
 * Mason asked for an "average rebook rating". A mean over an ordinal ladder
 * produces "2.3", which names no action, and it does something worse: it hides
 * one disastrous gig behind four fine ones. The number that matters when you
 * are staffing is not central tendency, it is "is there a reason not to".
 *
 * So: the headline is the MOST RECENT judgement, because people improve and
 * decline and the latest gig is the best evidence of who they are now — but a
 * `never` recorded at any point sets `hardNo`, which the UI must surface
 * regardless of age. Recency decides the label; the downside is never buried.
 *
 * `ratings` must arrive newest-first.
 *
 * `baseline` is the person-level standing opinion (`crew.rehire`), for people
 * with no rated gigs yet — most of the roster, since 89 crew carry 40 event
 * links. A REAL PER-GIG RATING ALWAYS WINS: the baseline is what you knew
 * before the data existed and it steps aside the moment the data does. It is
 * counted in the tally only when nothing else is, so it can never inflate a
 * distribution built from actual gigs.
 */
export function rehireStanding(
  ratings: (string | null)[],
  baseline?: string | null
): RehireStanding {
  const tally: Record<Rehire, number> = {
    first_call: 0, solid: 0, last_resort: 0, never: 0,
  };
  let headline: Rehire | null = null;
  for (const raw of ratings) {
    const r = cleanRehire(raw);
    if (!r) continue;
    if (headline === null) headline = r; // first non-null = most recent
    tally[r]++;
  }
  const total = REHIRE_LADDER.reduce((n, k) => n + tally[k], 0);
  if (total === 0) {
    // Nothing from a real gig — fall back to the standing opinion. `total`
    // stays 0 so a caller can still tell "seeded" from "earned", and
    // `fromBaseline` says so explicitly rather than making that inferable only
    // from a zero.
    const seed = cleanRehire(baseline);
    if (seed) {
      return { headline: seed, tally, total: 0, hardNo: seed === "never", fromBaseline: true };
    }
  }
  return { headline, tally, total, hardNo: tally.never > 0, fromBaseline: false };
}

/**
 * ── `can_lead` and `travels` are GONE (2026-08-15) ──
 *
 * Mason: "I still see can lead/Cannot lead toggle throughout and can lead on
 * regulars. Also seeing travels/local-only. Let's drop these data points
 * everywhere. We don't need to track."
 *
 * Both were standing capabilities that duplicated something better. `can_lead`
 * overlapped the per-gig `lead` ROLE — who actually led a gig is a fact, and a
 * standing "could lead" is a guess you then have to maintain. `travels`
 * overlapped the radius search: distance already says what a trip costs, and
 * 35 of 61 people had the flag unset, so reading it as "will not travel" would
 * have dropped half the roster from any search that trusted it.
 *
 * The columns are LEFT IN PLACE, unread and unwritten. Dropping a column is
 * irreversible and these hold no traffic; leaving them dormant costs nothing
 * and keeps the door open. Nothing in the app reads them.
 */

/**
 * The order EVERY crew picker uses. One home, so pickers cannot disagree.
 *
 * Mason, 2026-08-15: "drop the 'do not hires' to the end of our list so we can
 * keep them in the system, but they automatically go to the bottom."
 *
 * That is the whole reason the ladder is ordinal rather than three loose tags.
 * Note it is a SINK, not a filter: a "never again" stays visible and findable,
 * because the record of why you will not book someone is the point — deleting
 * them means re-learning it in two years when the name comes back around.
 * Archiving is the separate, deliberate act for people who are simply gone.
 *
 * Sorted in memory rather than by Postgres because `hardNo` is derived from
 * `event_crew` rows, not a `crew` column. The roster is ~89 people and is
 * already loaded whole; a denormalised column would be a cache to invalidate
 * for no gain at this size.
 */
export function compareCrewForPicker(
  a: { hardNo?: boolean; isRegular?: boolean; name: string },
  b: { hardNo?: boolean; isRegular?: boolean; name: string }
): number {
  // A hard no sinks regardless of anything else, including being a regular —
  // that combination is a contradiction someone needs to see, not resolve.
  if (!!a.hardNo !== !!b.hardNo) return a.hardNo ? 1 : -1;
  if (!!a.isRegular !== !!b.isRegular) return a.isRegular ? -1 : 1;
  return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
}
