/**
 * Matching a name to a calendar gig — the one home for the scoring.
 *
 * This was written inside `scripts/match-calendar.ts` and lived there alone,
 * which was fine while the backfill was the only caller. It is not: the create
 * screen looks a gig up as the name is typed, and `tasks/event-intel.md` has
 * promised since the design that "the backfill calls it 1,371 times; the upload
 * flow calls it once" would be the SAME function. Two copies of a scoring rule
 * is how one of them silently stops agreeing with the other — the repeated
 * failure in this codebase (the share cover, the gallery preview, the PIN
 * inheritance), always discovered from a surface that had quietly drifted.
 *
 * Two entry points, because they are genuinely different questions:
 *
 *   scoreNameAgainstClient()  a whole gallery name vs a whole booking label.
 *                             What the backfill asks, 1,371 times.
 *   scoreTypeahead()          a FRAGMENT someone is still typing vs a gig.
 *                             What the create screen asks, on every keystroke.
 *
 * They share the signal set. The typeahead adds prefix matching on top, because
 * "perk" is not a token overlap with "Perkin Elmer" and never will be — the
 * backfill never sees a half-typed word and must not start guessing from one.
 */
import type { CalendarEventLike } from "./parse-calendar";

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Keep SHORT tokens. "FM Headshots" is a real client whose only distinguishing
 * token is two characters, and dropping it left nothing but the stopword
 * "headshots" — so a gallery matched a gig with the identical name at zero.
 * Same for PG&E. Short filler words are excluded by STOP instead.
 */
export const tokens = (s: string) => norm(s).split(" ").filter((t) => t.length >= 2);

/** Words that appear in half the gallery names and carry no identity. */
export const STOP = new Set([
  "headshots", "headshot", "photos", "photo", "booth", "event", "events", "party",
  "holiday", "gala", "conference", "summit", "the", "and", "for", "with", "day",
  "sko", "annual", "meeting", "reception", "portraits", "portrait", "shoot",
  // Short filler, now that 2-character tokens are kept.
  "of", "at", "in", "on", "to", "by", "vs", "st", "nd", "rd", "th",
]);

/**
 * Levenshtein, capped. Used only as a last resort on whole names.
 *
 * Mason: "Joey is not good with details and often has typos." The gallery said
 * NICK LAMBARDO'S HEADSHOTS; the booking says Nick Lombardo. One character, and
 * every other signal scores it zero.
 */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    if (Math.min(...cur) > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Initials of the meaningful words: "Construction of Excellence Award" → "cea". */
export function acronym(s: string): string {
  return tokens(s).filter((t) => !STOP.has(t)).map((t) => t[0]).join("");
}

export interface NameMatch {
  score: number;
  shared: string[];
}

/**
 * How much do two names look like the same client?
 *
 * Computes EVERY signal and takes the best, rather than returning on the first
 * hit. Returning early on token overlap meant "CEA Show 26" matched
 * "Construction of Excellence Award Show" on the shared word "show" alone — a
 * 0.33 that fell below threshold — and the acronym rule that would have scored
 * it 0.75 was never reached. A weak signal must not shadow a strong one.
 */
export function scoreNameAgainstClient(a: string, b: string): NameMatch {
  const ta = new Set(tokens(a).filter((t) => !STOP.has(t)));
  const tb = new Set(tokens(b).filter((t) => !STOP.has(t)));
  if (!ta.size || !tb.size) return { score: 0, shared: [] };

  const signals: NameMatch[] = [];

  // 1. Shared meaningful tokens — the ordinary case.
  const shared = [...ta].filter((t) => tb.has(t));
  if (shared.length) signals.push({ score: shared.length / Math.min(ta.size, tb.size), shared });

  const ja = [...ta].join("");
  const jb = [...tb].join("");

  // 2. Compound: "COLLEGEBOARD" vs "College Board". Floored so short names
  //    cannot swallow each other — "ebay" inside "ebaymotors" is a coincidence.
  if (ja.length >= 8 && jb.length >= 8 && (ja.includes(jb) || jb.includes(ja))) {
    signals.push({ score: 0.8, shared: ["compound"] });
  }

  // 3. Acronym: Mason names galleries by the short form the client uses, the
  //    calendar carries the full name. 3+ letters, so two-letter coincidences
  //    cannot fire.
  for (const [short, long] of [[a, b], [b, a]] as const) {
    const shortTokens = tokens(short).filter((t) => !STOP.has(t));
    const initials = acronym(long);
    const hit = shortTokens.find((t) => t.length >= 3 && initials.startsWith(t));
    if (hit) signals.push({ score: 0.75, shared: [`acronym:${hit}`] });
  }

  // 4. Typo, last and weakest. "Lambardo" vs "Lombardo" — one character, and
  //    every other signal scores it zero.
  if (ja.length >= 6 && jb.length >= 6) {
    const d = editDistance(ja, jb, 2);
    if (d <= 2) signals.push({ score: 0.7 - d * 0.05, shared: [`typo:${d}`] });
  }

  if (!signals.length) return { score: 0, shared: [] };
  return signals.reduce((best, s) => (s.score > best.score ? s : best));
}

export const daysApart = (a: string, b: string) =>
  Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000));

/**
 * Score a half-typed fragment against a gig's searchable text.
 *
 * Separate from `scoreNameAgainstClient` on purpose. The backfill compares two
 * finished names and must stay strict — a prefix rule there would match "Pure
 * Storage" to "Purely Social" and quietly attach the wrong crew to a gallery
 * nobody re-checks. A typeahead has the opposite failure mode: the human is
 * looking at the list and picks, so an extra candidate costs a glance while a
 * missing one costs the whole feature.
 *
 * `haystack` is every string worth searching — the booking label, the raw
 * title, the venue, the city — because Mason looks a gig up by whatever he
 * happens to remember about it.
 */
export function scoreTypeahead(query: string, haystack: string[]): NameMatch {
  const q = norm(query);
  if (q.length < 2) return { score: 0, shared: [] };
  const qTokens = tokens(query);
  if (!qTokens.length) return { score: 0, shared: [] };

  const joined = haystack.filter(Boolean).join(" ");
  const hayTokens = tokens(joined);
  if (!hayTokens.length) return { score: 0, shared: [] };

  const signals: NameMatch[] = [];

  // The strict signals still apply, against the primary label.
  const strict = scoreNameAgainstClient(query, haystack[0] ?? "");
  if (strict.score > 0) signals.push(strict);

  /**
   * Prefix coverage: what fraction of what they have typed so far is the start
   * of some word in this gig? Scored by COVERAGE rather than by hit count, so
   * typing more words narrows the list instead of widening it — "perkin scot"
   * only stays top if both fragments land.
   */
  const hit = qTokens.filter((t) => hayTokens.some((h) => h.startsWith(t)));
  if (hit.length) {
    signals.push({ score: 0.55 + 0.4 * (hit.length / qTokens.length), shared: hit });
  }

  // A contiguous substring of the whole label — "foot locker", "elmer sko".
  if (q.length >= 4 && norm(joined).includes(q)) {
    signals.push({ score: 0.95, shared: [q] });
  }

  if (!signals.length) return { score: 0, shared: [] };
  return signals.reduce((best, s) => (s.score > best.score ? s : best));
}

export interface Gig {
  client: string | null;
  start: string;
  end: string;
  events: CalendarEventLike[];
}

export interface RankedGig<G extends Gig = Gig> {
  gig: G;
  score: number;
  shared: string[];
  /** Days between the gig and the date being matched; null when no date given. */
  dayGap: number | null;
}

/**
 * Rank gigs against a name and (optionally) a date.
 *
 * Date proximity is a TIEBREAK, not evidence on its own: several gigs a week
 * share a date and only the name says which one this gallery is. Weighting it
 * as evidence is how a gallery gets attached to the wrong job on a busy
 * Saturday.
 */
export function rankGigs<G extends Gig>(
  gigs: G[],
  {
    name,
    day,
    windowDays = 4,
    minScore = 0,
    typeahead = false,
    haystack,
  }: {
    name: string;
    day?: string | null;
    windowDays?: number;
    minScore?: number;
    typeahead?: boolean;
    /** Extra searchable strings per gig, for the typeahead. */
    haystack?: (gig: G) => string[];
  }
): RankedGig<G>[] {
  return gigs
    .filter((g) => {
      if (!day) return true;
      return daysApart(g.start, day) <= windowDays || daysApart(g.end, day) <= windowDays;
    })
    .map((g) => {
      const client = g.client ?? "";
      const ns = typeahead
        ? scoreTypeahead(name, haystack ? haystack(g) : [client])
        : scoreNameAgainstClient(name, client);
      const dayGap = day ? Math.min(daysApart(g.start, day), daysApart(g.end, day)) : null;
      const proximity = dayGap === null ? 1 : dayGap === 0 ? 1 : dayGap <= 1 ? 0.95 : 0.85;
      return { gig: g, score: ns.score * proximity, shared: ns.shared, dayGap };
    })
    .filter((c) => c.score > minScore)
    .sort((a, b) => b.score - a.score);
}
