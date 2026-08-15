/**
 * Writing a calendar gig onto an event — venue, crew, payer, provenance.
 *
 * Shared by the create screen (one event, human-confirmed at the moment of
 * creation) and available to the backfill (1,371 events, all unconfirmed). The
 * two differ in exactly one argument, `confirmed`, and in nothing else — which
 * is the point. The venue-reuse key and the payer-domain rule were previously
 * inline in the backfill script, so a second writer meant a second dialect of
 * "have we already got this venue".
 *
 * OWNERSHIP. Every read and write here is scoped by `userId`. The callers hand
 * in the SERVICE client (`getAuthUser()` returns it and RLS is bypassed), so an
 * unscoped query is an IDOR — the omission that has shipped from this repo
 * twice. `userId` is not optional and is never taken from the request body.
 */
import { parseVenue, venueKey, type ParsedVenue } from "./parse-calendar";
import { cleanConfirmedRoles, cleanRoles } from "./roles";

/** The service client, which has no useful public type here. */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Db = any;

/**
 * Addresses that never identify a payer.
 *
 * `twodudesphoto.com` is ours and must be excluded or it becomes our own
 * biggest client; the consumer mail hosts carry no company signal at all.
 */
const NOT_A_PAYER = /twodudesphoto|gmail|hotmail|yahoo|outlook|icloud|me\.com|att\.net/;

/** Distinct payer domains implied by a set of contact addresses. */
export function payerDomains(emails: string[]): string[] {
  return [
    ...new Set(
      emails
        .map((e) => e.split("@")[1]?.toLowerCase())
        .filter((d): d is string => !!d && !NOT_A_PAYER.test(d))
    ),
  ];
}

/**
 * The reuse key for a venue ALREADY STORED, matching `venueKey`'s transformation
 * on the fields a `venues` row actually has.
 */
export function storedVenueKey(v: { name: string | null; city: string | null }): string {
  return `${(v.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}|${(v.city ?? "").toLowerCase()}`;
}

/** A domain turned into a first-guess label: `opusagency.com` → "Opus Agency". */
export function domainToName(domain: string): string {
  return domain
    .replace(/\.(com|org|net|io|co|ai|edu)$/i, "")
    .replace(/[-.]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface CrewAssignment {
  crewId: string;
  roles?: string[];
  confirmedRoles?: string[];
}

export interface ApplyGigInput {
  userId: string;
  eventId: string;
  /** The calendar's `location` string, unparsed — or an already-parsed venue. */
  venue?: string | ParsedVenue | null;
  crew?: CrewAssignment[];
  /** Contact-email domains that name the payer. */
  orgDomains?: string[];
  calendarEventIds?: string[];
  /**
   * Did a HUMAN say this gallery is this gig?
   *
   * True from the create screen, where picking the gig IS the confirmation.
   * False from the backfill, whose every row is a suggestion with its working
   * shown. `confirmed_at` is what stops a later calendar edit clobbering a
   * correction, so it is the difference between a guess worth revising and a
   * decision that must be left alone.
   */
  confirmed: boolean;
}

export interface ApplyGigResult {
  venueId: string | null;
  crewLinked: number;
  orgsLinked: number;
  /** Non-fatal problems. Intel must never be able to fail the thing it decorates. */
  warnings: string[];
}

/**
 * Attach a gig's facts to an event that already exists.
 *
 * Never throws for a partial failure. This runs on the tail of event creation,
 * and an event that exists without its venue is a small gap a human can fill;
 * a create button that 500s because a venue name collided is a broken app. Each
 * leg reports instead.
 */
export async function applyGigIntel(db: Db, input: ApplyGigInput): Promise<ApplyGigResult> {
  const { userId, eventId, confirmed } = input;
  const warnings: string[] = [];

  // ── venue ──
  let venueId: string | null = null;
  const parsed: ParsedVenue | null =
    typeof input.venue === "string" ? parseVenue(input.venue) : (input.venue ?? null);

  if (parsed && (parsed.name || parsed.street)) {
    const key = venueKey(parsed);
    const { data: existing, error: lookupErr } = await db
      .from("venues")
      .select("id, name, city")
      .eq("user_id", userId);
    if (lookupErr) {
      warnings.push(`venue lookup: ${lookupErr.message}`);
    } else {
      // Built field-by-field rather than by casting a row to ParsedVenue:
      // `venueKey` falls back to `street` then `raw`, neither of which exists on
      // a `venues` row, so a venue with a null name would read `undefined` and
      // throw. Same transformation, no fictional fields.
      const hit = (existing ?? []).find(
        (v: { name: string | null; city: string | null }) => storedVenueKey(v) === key
      );
      if (hit) {
        venueId = hit.id;
      } else {
        const { data: made, error: vErr } = await db
          .from("venues")
          .insert({
            user_id: userId,
            name: parsed.name ?? parsed.street ?? parsed.raw,
            address: parsed.street,
            city: parsed.city,
            region: parsed.region,
            country: parsed.country,
          })
          .select("id")
          .single();
        // 23505 is a name collision with a venue whose key did not match —
        // different city spelling, same name. Not fatal; the human can attach
        // the right one from the Intel tab.
        if (vErr) warnings.push(`venue: ${vErr.message}`);
        else venueId = made.id;
      }
    }
  }

  // ── the intel row ──
  const { error: iErr } = await db.from("event_intel").upsert(
    {
      event_id: eventId,
      user_id: userId,
      venue_id: venueId,
      calendar_event_ids: (input.calendarEventIds ?? []).filter(Boolean),
      source: "calendar",
      ...(confirmed ? { confirmed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id" }
  );
  if (iErr) warnings.push(`intel: ${iErr.message}`);

  // ── crew ──
  let crewLinked = 0;
  const asked = input.crew ?? [];
  if (asked.length) {
    // Verify every person is on the CALLER'S roster before linking them. The
    // ids arrive from a request body; a crew id belonging to someone else must
    // not become a row on this user's event.
    const { data: mine, error: rErr } = await db
      .from("crew")
      .select("id")
      .eq("user_id", userId)
      .in(
        "id",
        asked.map((c) => c.crewId)
      );
    if (rErr) {
      warnings.push(`roster: ${rErr.message}`);
    } else {
      const allowed = new Set((mine ?? []).map((c: { id: string }) => c.id));
      for (const person of asked) {
        if (!allowed.has(person.crewId)) {
          warnings.push(`crew ${person.crewId}: not on your roster`);
          continue;
        }
        const roles = cleanRoles(person.roles ?? []);
        const { error: cErr } = await db.from("event_crew").upsert(
          {
            event_id: eventId,
            crew_id: person.crewId,
            user_id: userId,
            roles,
            confirmed_roles: cleanConfirmedRoles(person.confirmedRoles, roles),
            /**
             * Provenance follows the same answer as `confirmed_at`, and is
             * derived rather than hardcoded so the backfill can adopt this
             * function without silently promoting 1,371 machine guesses to
             * human decisions.
             *
             * A role chosen on the create screen is a HUMAN's, so nothing may
             * revise it. A person attached with no role there is still the
             * machine's reading of the attendee list — but the human accepted
             * that reading by creating the event from this gig, so the row is
             * theirs either way.
             */
            roles_source: confirmed ? "manual" : "calendar",
          },
          { onConflict: "event_id,crew_id" }
        );
        if (cErr) warnings.push(`crew ${person.crewId}: ${cErr.message}`);
        else crewLinked++;
      }
    }
  }

  // ── payer ──
  let orgsLinked = 0;
  for (const domain of input.orgDomains ?? []) {
    const clean = domain.trim().toLowerCase();
    if (!clean || NOT_A_PAYER.test(clean)) continue;

    const { data: found, error: oLookErr } = await db
      .from("organizations")
      .select("id")
      .eq("user_id", userId)
      .contains("domains", [clean])
      .maybeSingle();
    if (oLookErr) {
      warnings.push(`org lookup ${clean}: ${oLookErr.message}`);
      continue;
    }

    let orgId: string | null = found?.id ?? null;
    if (!orgId) {
      const { data: made, error: oErr } = await db
        .from("organizations")
        .insert({ user_id: userId, name: domainToName(clean), domains: [clean] })
        .select("id")
        .single();
      if (oErr) {
        warnings.push(`org ${clean}: ${oErr.message}`);
        continue;
      }
      orgId = made.id;
    }

    const { error: eoErr } = await db.from("event_orgs").upsert(
      { event_id: eventId, org_id: orgId, user_id: userId, role: "payer" },
      { onConflict: "event_id,org_id,role" }
    );
    if (eoErr) warnings.push(`event_org ${clean}: ${eoErr.message}`);
    else orgsLinked++;
  }

  return { venueId, crewLinked, orgsLinked, warnings };
}
