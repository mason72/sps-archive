/**
 * The Event Intel pivot — every cross-section, built once.
 *
 * Mason's ask was "like a pivot table or matrix to look up people, venues,
 * cities, clients". A pivot is not four separate queries; it is ONE fact table
 * (the event, with its venue, crew and organisations attached) read along four
 * different axes. Building it that way means a person's cities, a city's crew
 * and a venue's clients all fall out of the same pass and can never disagree
 * with each other.
 *
 * SIZE. This deliberately reads whole tables and joins in memory: 89 crew, 42
 * links, 23 intel rows, 17 venues. Postgres would do it faster in principle and
 * far slower in practice, at four round trips per axis instead of six total. If
 * this ever reaches thousands of gigs, the fix is a materialised view, not a
 * clever query — but that is a decade of shooting away.
 *
 * OWNERSHIP. Every read carries `.eq("user_id", …)`, because the caller hands
 * in the SERVICE client and RLS is bypassed. `events` has no user_id, so it is
 * scoped by the id set the intel rows already established.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import { metroKeys, metroKey, metroLabel } from "./geo";
import { rehireStanding, type RehireStanding } from "./roles";

type DB = ReturnType<typeof createServiceClient>;

export interface IntelCrewOnEvent {
  crewId: string;
  name: string;
  roles: string[];
  /** 'inferred' = a machine guessed it. Must reach the UI, or a guess reads as a fact. */
  rolesSource: string;
  wouldRebook: string | null;
  note: string | null;
}

export interface IntelOrgOnEvent {
  orgId: string;
  name: string;
  role: string;
}

export interface IntelEvent {
  id: string;
  name: string;
  date: string | null;
  venueId: string | null;
  venueName: string | null;
  city: string | null;
  region: string | null;
  crew: IntelCrewOnEvent[];
  orgs: IntelOrgOnEvent[];
  notes: string | null;
  confirmed: boolean;
}

export interface IntelPerson {
  id: string;
  name: string;
  fullName: string | null;
  email: string | null;
  kind: string;
  homeCity: string | null;
  canLead: string | null;
  travels: boolean | null;
  archived: boolean;
  notes: string | null;
  eventCount: number;
  /** Newest first — what "when did we last use them" needs. */
  events: { id: string; name: string; date: string | null; roles: string[]; rolesSource: string; wouldRebook: string | null; note: string | null }[];
  /** Only roles a human confirmed — see the comment where this is built. */
  roleCounts: Record<string, number>;
  /** Gigs whose roles are still a machine's guess. */
  inferredRoleCount: number;
  cities: string[];
  venueIds: string[];
  orgIds: string[];
  /** People they have actually worked alongside, by shared event. */
  coCrewIds: string[];
  /** Do you reach for them. MARKED, never derived from an event count. */
  isRegular: boolean;
  /**
   * Their rehire standing: the most recent per-gig judgement, the distribution
   * behind it, and a hard-no flag that survives regardless of age. Falls back
   * to `crew.rehire` — the person-level opinion — only when no gig has been
   * rated, which is most of the roster (89 crew, 40 links).
   */
  standing: RehireStanding;
  /** The seeded opinion itself, so the editor can show what it is editing. */
  rehireBaseline: string | null;
}

export interface IntelVenue {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  notes: string | null;
  eventCount: number;
  events: { id: string; name: string; date: string | null }[];
  crewIds: string[];
  orgIds: string[];
}

export interface IntelCity {
  /** Lowercased key; `name` is what to show. */
  key: string;
  name: string;
  region: string | null;
  eventCount: number;
  events: { id: string; name: string; date: string | null }[];
  venueIds: string[];
  crewIds: string[];
  /**
   * Crew who LIVE here — the hiring question, which is not the worked-here one.
   * Matched on METRO (see `geo.ts`): a venue in San Jose and a roster entry
   * saying "Bay Area" are the same answer, and comparing the raw strings
   * returned zero for all 47 cities.
   */
  localCrewIds: string[];
}

export interface IntelOrg {
  id: string;
  name: string;
  kind: string;
  domains: string[];
  notes: string | null;
  eventCount: number;
  events: { id: string; name: string; date: string | null; role: string }[];
  venueIds: string[];
  cities: string[];
  crewIds: string[];
}

export interface IntelIndex {
  events: IntelEvent[];
  people: IntelPerson[];
  venues: IntelVenue[];
  cities: IntelCity[];
  orgs: IntelOrg[];
  /** Events with no intel row at all — the backlog, and the honest denominator. */
  uncoveredEventCount: number;
  totalEventCount: number;
}

const cityKey = (c: string | null | undefined) =>
  (c ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Newest first, undated last — an undated gig is not a 1970 gig. */
function byDateDesc<T extends { date: string | null }>(a: T, b: T): number {
  if (!a.date && !b.date) return 0;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return b.date.localeCompare(a.date);
}

const uniq = (xs: (string | null | undefined)[]) =>
  [...new Set(xs.filter((x): x is string => !!x))];

export async function buildIntelIndex(db: DB, userId: string): Promise<IntelIndex> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any;

  // A Supabase error is a RETURN VALUE. `data || []` on a failed query is an
  // empty pivot that looks exactly like an empty archive.
  const need = <T,>(r: { data: T[] | null; error: { message: string } | null }, what: string): T[] => {
    if (r.error) throw new Error(`intel: ${what} — ${r.error.message}`);
    return r.data ?? [];
  };

  const [crewRes, venueRes, orgRes, intelRes, ecRes, eoRes] = await Promise.all([
    anyDb.from("crew").select("*").eq("user_id", userId),
    anyDb.from("venues").select("*").eq("user_id", userId),
    anyDb.from("organizations").select("*").eq("user_id", userId),
    anyDb.from("event_intel").select("*").eq("user_id", userId),
    anyDb.from("event_crew").select("*").eq("user_id", userId),
    anyDb.from("event_orgs").select("*").eq("user_id", userId),
  ]);

  const crewRows = need<any>(crewRes, "crew");
  const venueRows = need<any>(venueRes, "venues");
  const orgRows = need<any>(orgRes, "organizations");
  const intelRows = need<any>(intelRes, "event_intel");
  const ecRows = need<any>(ecRes, "event_crew");
  const eoRows = need<any>(eoRes, "event_orgs");

  // Events are scoped by ownership through their own user_id column; the intel
  // rows are a subset, and the difference is the backlog worth reporting.
  const evRes = await anyDb
    .from("events")
    .select("id,name,sort_date")
    .eq("user_id", userId)
    .order("sort_date", { ascending: false });
  const eventRows = need<any>(evRes, "events");

  const crewById = new Map<string, any>(crewRows.map((c) => [c.id, c]));
  const venueById = new Map<string, any>(venueRows.map((v) => [v.id, v]));
  const orgById = new Map<string, any>(orgRows.map((o) => [o.id, o]));
  const intelByEvent = new Map<string, any>(intelRows.map((i) => [i.event_id, i]));

  const crewByEvent = new Map<string, IntelCrewOnEvent[]>();
  for (const r of ecRows) {
    const person = crewById.get(r.crew_id);
    if (!person) continue;
    const list = crewByEvent.get(r.event_id) ?? [];
    list.push({
      crewId: r.crew_id,
      name: person.display_name,
      roles: r.roles ?? [],
      rolesSource: r.roles_source ?? "manual",
      wouldRebook: r.would_rebook ?? null,
      note: r.note ?? null,
    });
    crewByEvent.set(r.event_id, list);
  }

  const orgsByEvent = new Map<string, IntelOrgOnEvent[]>();
  for (const r of eoRows) {
    const org = orgById.get(r.org_id);
    if (!org) continue;
    const list = orgsByEvent.get(r.event_id) ?? [];
    list.push({ orgId: r.org_id, name: org.name, role: r.role });
    orgsByEvent.set(r.event_id, list);
  }

  // ── The fact table ────────────────────────────────────────────────────────
  const events: IntelEvent[] = eventRows.map((e) => {
    const intel = intelByEvent.get(e.id);
    const venue = intel?.venue_id ? venueById.get(intel.venue_id) : null;
    return {
      id: e.id,
      name: e.name,
      date: e.sort_date ?? null,
      venueId: venue?.id ?? null,
      venueName: venue?.name ?? null,
      city: venue?.city ?? null,
      region: venue?.region ?? null,
      crew: crewByEvent.get(e.id) ?? [],
      orgs: orgsByEvent.get(e.id) ?? [],
      notes: intel?.notes ?? null,
      confirmed: !!intel?.confirmed_at,
    };
  });

  const eventById = new Map(events.map((e) => [e.id, e]));

  // ── Axis: people ──────────────────────────────────────────────────────────
  const people: IntelPerson[] = crewRows.map((c) => {
    const mine = ecRows.filter((r) => r.crew_id === c.id);
    const evs = mine
      .map((r) => {
        const e = eventById.get(r.event_id);
        if (!e) return null;
        return {
          id: e.id,
          name: e.name,
          date: e.date,
          roles: (r.roles ?? []) as string[],
          rolesSource: (r.roles_source ?? "manual") as string,
          wouldRebook: (r.would_rebook ?? null) as string | null,
          note: (r.note ?? null) as string | null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort(byDateDesc);

    /**
     * CONFIRMED ROLES ONLY. "Joey led 13 gigs" is a rehire-grade claim, and
     * counting guesses into it would make the tally say exactly the same thing
     * whether a human decided or a regex did. Inferred roles still show on each
     * gig line, marked as provisional — they just do not become a statistic.
     */
    const roleCounts: Record<string, number> = {};
    for (const e of evs) {
      if (e.rolesSource !== "manual") continue;
      for (const role of e.roles) roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    }
    const inferredRoleCount = evs.filter((e) => e.rolesSource === "inferred" && e.roles.length).length;

    /**
     * `evs` is newest-first (see where it is built), which is exactly what
     * `rehireStanding` needs: the headline is the most recent judgement, not an
     * average. An average over an ordinal ladder names no action and buries one
     * disastrous gig under four fine ones.
     */
    const standing = rehireStanding(evs.map((e) => e.wouldRebook), c.rehire ?? null);

    const attended = evs.map((e) => eventById.get(e.id)!);
    return {
      id: c.id,
      name: c.display_name,
      fullName: c.full_name ?? null,
      email: c.primary_email ?? null,
      kind: c.kind ?? "other",
      homeCity: c.city ?? null,
      canLead: c.can_lead ?? null,
      travels: c.travels ?? null,
      archived: !!c.archived,
      notes: c.notes ?? null,
      eventCount: evs.length,
      events: evs,
      roleCounts,
      inferredRoleCount,
      cities: uniq(attended.map((e) => e.city)),
      venueIds: uniq(attended.map((e) => e.venueId)),
      orgIds: uniq(attended.flatMap((e) => e.orgs.map((o) => o.orgId))),
      coCrewIds: uniq(attended.flatMap((e) => e.crew.map((x) => x.crewId))).filter((id) => id !== c.id),
      isRegular: !!c.is_regular,
      standing,
      rehireBaseline: c.rehire ?? null,
    };
  });

  // ── Axis: venues ──────────────────────────────────────────────────────────
  const venues: IntelVenue[] = venueRows.map((v) => {
    const evs = events.filter((e) => e.venueId === v.id);
    return {
      id: v.id,
      name: v.name,
      address: v.address ?? null,
      city: v.city ?? null,
      region: v.region ?? null,
      notes: v.notes ?? null,
      eventCount: evs.length,
      events: evs.map((e) => ({ id: e.id, name: e.name, date: e.date })).sort(byDateDesc),
      crewIds: uniq(evs.flatMap((e) => e.crew.map((c) => c.crewId))),
      orgIds: uniq(evs.flatMap((e) => e.orgs.map((o) => o.orgId))),
    };
  });

  // ── Axis: cities ──────────────────────────────────────────────────────────
  /**
   * Grouped by METRO, not by the raw Google city.
   *
   * Mason: "why do you have Bronx and not New York City? Bronx is part of New
   * York City." Right — and the inconsistency was mine: `geo.ts` already
   * existed so "San Jose" and "Bay Area" would match for crew, and then this
   * grouped on the raw string anyway. So the Bronx sat as a peer of San
   * Francisco while the matching logic knew better.
   *
   * The specific city is not lost: it stays on the venue, which is where "which
   * building" is actually answered.
   */
  const cityMap = new Map<string, IntelCity>();
  const touchCity = (name: string | null, region: string | null): IntelCity | null => {
    const raw = (name ?? "").trim();
    if (!raw) return null;
    const key = metroKey(raw) ?? cityKey(raw);
    let c = cityMap.get(key);
    if (!c) {
      c = {
        key,
        name: metroLabel(key),
        region, eventCount: 0, events: [], venueIds: [], crewIds: [], localCrewIds: [],
      };
      cityMap.set(key, c);
    }
    return c;
  };
  for (const e of events) {
    const c = touchCity(e.city, e.region);
    if (!c) continue;
    c.eventCount++;
    c.events.push({ id: e.id, name: e.name, date: e.date });
    if (e.venueId) c.venueIds.push(e.venueId);
    for (const x of e.crew) c.crewIds.push(x.crewId);
  }
  /**
   * A crew member's home matters even in a city we have never shot — that IS the
   * "who could we hire in Phoenix" question, and it is answered by the roster,
   * not by history.
   *
   * Each person is attached to every metro they claim ("Seattle/LV/NYC" is three)
   * and to every existing city row in those metros, so a gig in Coppell finds a
   * crew member who wrote "Dallas".
   */
  // The row's key IS its metro now, so compare against that rather than
  // re-deriving from the display label ("Dallas–Fort Worth" is not a lookup key).
  const cityMetros = new Map<string, string[]>();
  for (const c of cityMap.values()) cityMetros.set(c.key, [c.key]);

  for (const p of people) {
    const homes = metroKeys(p.homeCity);
    if (homes.length === 0) continue;
    let placed = false;
    for (const [key, metros] of cityMetros) {
      if (metros.some((m) => homes.includes(m))) {
        cityMap.get(key)!.localCrewIds.push(p.id);
        placed = true;
      }
    }
    // Somewhere we have never shot still deserves a row — that is exactly where
    // "who do we know here" is worth asking.
    if (!placed) {
      const c = touchCity(p.homeCity, null);
      if (c) c.localCrewIds.push(p.id);
    }
  }
  const cities = [...cityMap.values()].map((c) => ({
    ...c,
    events: c.events.sort(byDateDesc),
    venueIds: uniq(c.venueIds),
    crewIds: uniq(c.crewIds),
    localCrewIds: uniq(c.localCrewIds),
  }));

  // ── Axis: organisations ───────────────────────────────────────────────────
  const orgs: IntelOrg[] = orgRows.map((o) => {
    const links = eoRows.filter((r) => r.org_id === o.id);
    const evs = links
      .map((r) => {
        const e = eventById.get(r.event_id);
        return e ? { e, role: r.role as string } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    return {
      id: o.id,
      name: o.name,
      kind: o.kind ?? "unknown",
      domains: o.domains ?? [],
      notes: o.notes ?? null,
      eventCount: evs.length,
      events: evs.map(({ e, role }) => ({ id: e.id, name: e.name, date: e.date, role })).sort(byDateDesc),
      venueIds: uniq(evs.map(({ e }) => e.venueId)),
      cities: uniq(evs.map(({ e }) => e.city)),
      crewIds: uniq(evs.flatMap(({ e }) => e.crew.map((c) => c.crewId))),
    };
  });

  return {
    events,
    people: people.sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name)),
    venues: venues.sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name)),
    cities: cities.sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name)),
    orgs: orgs.sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name)),
    uncoveredEventCount: eventRows.filter((e) => !intelByEvent.has(e.id)).length,
    totalEventCount: eventRows.length,
  };
}
