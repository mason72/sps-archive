/**
 * Who worked which gig, from the EXPOSURE calendar, in the shape Scout reads.
 *
 * Identity is an email (migration 056): the calendar calls one person Joey,
 * Joseph and JOEY. So:
 *  - ATTENDEES carry the stable identity. Their email passes through,
 *    lower-cased, named from the roster when it is a crew member's primary
 *    email or one of their aliases.
 *  - TITLE names ("JOEY & JERRICK // Acme // Austin") resolve to a roster row
 *    through `crewNameKey`, first on the whole name, then on the first name,
 *    and only when exactly ONE crew member answers. An ambiguous or unknown
 *    name is returned with `email: null` so Scout can log it, never guessed
 *    (the same rule as scripts/infer-crew-roles.ts: a wrong person is worse
 *    than none).
 * One person appears once per gig; an attendee entry wins over a title entry
 * for the same crew member, because the attendee is the stronger evidence.
 *
 * Pure: the route reads the calendar and the roster and hands both in.
 */
import { crewNameKey } from "@/lib/event-intel/crew-name-key";
import { parseGig, type CalendarEventLike, type GigKind } from "@/lib/event-intel/parse-calendar";

export interface RosterRow {
  id: string;
  display_name: string;
  full_name: string | null;
  primary_email: string | null;
  aliases: string[] | null;
}

export interface GigCrewMember {
  email: string | null;
  display_name: string;
  source: "attendee" | "title";
  /**
   * True when this entry resolved to a crew roster row. Attendees pass through
   * whether or not they are crew (a client contact can be invited to the
   * calendar entry), so Scout must treat `on_roster: false` as "someone on the
   * invite", never as crew.
   */
  on_roster: boolean;
}

export interface GigCrew {
  calendar_event_id: string;
  start: string | null;
  end: string | null;
  title: string;
  kind: GigKind;
  city: string | null;
  venue: string | null;
  crew: GigCrewMember[];
}

export interface RosterIndex {
  byEmail: Map<string, RosterRow>;
  byName: Map<string, RosterRow[]>;
  byFirstName: Map<string, RosterRow[]>;
}

const isEmail = (s: string) => s.includes("@");
const firstWord = (s: string) => s.trim().split(/\s+/)[0] ?? "";

function addTo(map: Map<string, RosterRow[]>, key: string, row: RosterRow) {
  if (!key) return;
  const list = map.get(key) ?? [];
  if (!list.some((r) => r.id === row.id)) list.push(row);
  map.set(key, list);
}

export function buildRosterIndex(rows: RosterRow[]): RosterIndex {
  const byEmail = new Map<string, RosterRow>();
  const byName = new Map<string, RosterRow[]>();
  const byFirstName = new Map<string, RosterRow[]>();
  for (const row of rows) {
    for (const e of [row.primary_email, ...(row.aliases ?? [])]) {
      if (!e || !isEmail(e)) continue;
      const k = e.trim().toLowerCase();
      // Two crew rows claiming one address is a roster error; first wins and
      // the other is still reachable by name.
      if (!byEmail.has(k)) byEmail.set(k, row);
    }
    const names = [row.display_name, row.full_name, ...(row.aliases ?? []).filter((a) => !isEmail(a))];
    for (const n of names) {
      if (!n) continue;
      addTo(byName, crewNameKey(n), row);
      addTo(byFirstName, crewNameKey(firstWord(n)), row);
    }
  }
  return { byEmail, byName, byFirstName };
}

/** The ONE crew member a title name means, or null when none or several do. */
export function resolveTitleName(name: string, index: RosterIndex): RosterRow | null {
  const key = crewNameKey(name);
  if (!key) return null;
  const whole = index.byName.get(key) ?? [];
  if (whole.length === 1) return whole[0];
  if (whole.length > 1) return null;
  const first = index.byFirstName.get(crewNameKey(firstWord(name))) ?? [];
  return first.length === 1 ? first[0] : null;
}

/** A calendar or resource address is the calendar itself, not a person. */
const NOT_A_PERSON = /@(?:group\.calendar\.google\.com|resource\.calendar\.google\.com)$/i;

const emailOf = (r: RosterRow) => (r.primary_email ? r.primary_email.trim().toLowerCase() : null);

export function gigCrewFor(ev: CalendarEventLike, index: RosterIndex): GigCrew {
  const parsed = parseGig(ev);
  const crew: GigCrewMember[] = [];
  const seenCrewIds = new Set<string>();
  const seenEmails = new Set<string>();
  const seenUnresolved = new Set<string>();

  for (const a of parsed.attendees) {
    const email = a.email.toLowerCase();
    if (NOT_A_PERSON.test(email) || seenEmails.has(email)) continue;
    const row = index.byEmail.get(email) ?? null;
    if (row && seenCrewIds.has(row.id)) continue;
    seenEmails.add(email);
    if (row) seenCrewIds.add(row.id);
    crew.push({
      email,
      display_name: row?.display_name ?? a.displayName ?? email,
      source: "attendee",
      on_roster: !!row,
    });
  }

  for (const name of parsed.titleCrew) {
    const row = resolveTitleName(name, index);
    if (row) {
      if (seenCrewIds.has(row.id)) continue;
      const email = emailOf(row);
      if (email && seenEmails.has(email)) continue;
      seenCrewIds.add(row.id);
      if (email) seenEmails.add(email);
      crew.push({ email, display_name: row.display_name, source: "title", on_roster: true });
    } else {
      const k = crewNameKey(name);
      if (!k || seenUnresolved.has(k)) continue;
      seenUnresolved.add(k);
      crew.push({ email: null, display_name: name, source: "title", on_roster: false });
    }
  }

  return {
    calendar_event_id: ev.id ?? "",
    start: ev.start?.dateTime ?? ev.start?.date ?? null,
    end: ev.end?.dateTime ?? ev.end?.date ?? null,
    title: (ev.summary ?? "").trim(),
    kind: parsed.kind,
    city: parsed.city,
    venue: parsed.venue,
    crew,
  };
}

/** Calendar kinds that mean someone worked: the job itself and its set-up day. */
export const WORKED_KINDS: ReadonlySet<GigKind> = new Set<GigKind>(["gig", "setup"]);

/**
 * The window's gigs: entries that START on a day inside [from, to] (the day as
 * the calendar wrote it, so a late-evening gig is not moved by UTC) and read as
 * a job or its set-up. Travel, holds and unreadable entries are not work.
 */
export function gigsInWindow(
  events: CalendarEventLike[],
  { from, to }: { from: string; to: string },
  index: RosterIndex
): GigCrew[] {
  const out: GigCrew[] = [];
  for (const ev of events) {
    if (!ev.id) continue;
    const day = (ev.start?.date ?? ev.start?.dateTime ?? "").slice(0, 10);
    if (!day || day < from || day > to) continue;
    const g = gigCrewFor(ev, index);
    if (!WORKED_KINDS.has(g.kind)) continue;
    out.push(g);
  }
  return out;
}
