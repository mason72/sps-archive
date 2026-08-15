import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { fetchGigsInWindow, hasCalendarCredential, windowFor } from "@/lib/event-intel/lookup-gigs";
import { daysApart, rankGigs, type Gig } from "@/lib/event-intel/match-gig";
import { parseGig, parseVenue } from "@/lib/event-intel/parse-calendar";
import { payerDomains } from "@/lib/event-intel/apply-gig";

/**
 * GET /api/events/suggest-gig?q=&date=  — "which job is this?"
 *
 * Mason, 2026-08-15: "I was assuming it would be on the very first screen where
 * you create the event. Where you enter the name and date. And it pre-populates
 * if you use the autocomplete." This is the autocomplete. It looks the gig up
 * from the calendar as the name is typed and hands back everything the create
 * screen can pre-fill from it.
 *
 * INTERNAL, and it must stay that way. The response carries crew names, venue
 * addresses and client domains — the personnel data `tasks/event-intel.md`
 * requires to be structurally unreachable from any share or guest path. Auth
 * first, ownership filter on every registry read, no share slug anywhere near
 * it.
 *
 * A MISSING CREDENTIAL IS REPORTED, NOT SWALLOWED. `unavailable` distinguishes
 * "there is no calendar configured" from "no gig that day" — outwardly
 * identical, and only one of them is something a human can act on. Same rule as
 * `checkAccess()` in the calendar client, and the same reason: a lookup that
 * silently finds nothing looks exactly like a lookup with nothing to find.
 */

/** How many candidates are worth showing. Beyond this a list is not a shortlist. */
const MAX_RESULTS = 6;

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    const date = (searchParams.get("date") || "").trim() || null;

    // Two characters is where a prefix stops matching half the calendar.
    if (q.length < 2 && !date) {
      return NextResponse.json({ gigs: [], unavailable: null });
    }

    if (!hasCalendarCredential()) {
      return NextResponse.json({ gigs: [], unavailable: "no-credential" });
    }

    let gigs: Gig[];
    try {
      gigs = await fetchGigsInWindow(windowFor(date, new Date()));
    } catch (err) {
      // A calendar that will not answer is worth saying out loud on the page —
      // and worth an error row, because a silently suggestion-less create
      // screen is how this feature dies without anyone noticing.
      await reportSystemError("api.events.suggestGig.calendar", err, { hasDate: !!date });
      return NextResponse.json({ gigs: [], unavailable: "calendar-error" });
    }

    const ranked = rankGigs(gigs, {
      name: q,
      day: date,
      // Wider than the backfill's ±4: here a human is reading the list and
      // picking, so a near-miss costs a glance. The backfill has nobody
      // watching and stays strict.
      windowDays: 10,
      typeahead: true,
      // Mason looks a gig up by whatever he remembers — the client, the venue,
      // the city, or the crew names in the title.
      haystack: (g) => {
        const parsed = g.events.map(parseGig);
        return [
          g.client ?? "",
          ...g.events.map((e) => e.summary ?? ""),
          ...parsed.map((p) => p.venue ?? ""),
          ...parsed.map((p) => p.city ?? ""),
        ].filter(Boolean);
      },
    });

    /**
     * A date alone still lists that day's jobs.
     *
     * Not expressed as `rankGigs(… name: "")` — every score would be zero and
     * the `score > 0` filter would drop the lot, which is a silently empty list
     * rather than an obviously broken one. Ranking by date is a different
     * question and gets its own three lines.
     */
    const shortlist =
      q.length >= 2
        ? ranked.slice(0, MAX_RESULTS)
        : date
          ? gigs
              .filter((g) => daysApart(g.start, date) <= 2 || daysApart(g.end, date) <= 2)
              .sort((a, b) => daysApart(a.start, date) - daysApart(b.start, date))
              .slice(0, MAX_RESULTS)
              .map((gig) => ({
                gig,
                score: 0,
                shared: ["date"],
                dayGap: Math.min(daysApart(gig.start, date), daysApart(gig.end, date)),
              }))
          : [];

    // Empty shortlist: nothing to resolve, and no reason to load the roster.
    if (!shortlist.length) {
      return NextResponse.json({ gigs: [], unavailable: null });
    }

    // ── the registries, once, scoped to the caller ──
    const [crewRes, orgRes, mappedRes] = await Promise.all([
      db
        .from("crew")
        .select("id, display_name, primary_email, aliases, kind, is_regular, archived")
        .eq("user_id", user!.id),
      db.from("organizations").select("id, name, domains").eq("user_id", user!.id),
      /**
       * Which calendar entries already belong to a gallery.
       *
       * Mason, 2026-08-15: "do we ignore/suppress events that have already been
       * mapped or does the list have all events for all time?" It had all of
       * them — so a gig you made a gallery for months ago kept offering itself
       * forever, which is noise at best and a duplicate gallery at worst.
       *
       * MARKED, NOT HIDDEN. One gig legitimately produces two galleries
       * sometimes — a day split into separate deliveries, a re-shoot — and a
       * silently missing gig is indistinguishable from the calendar having lost
       * it. Same rule as everywhere else here: explain, never disappear.
       */
      db.from("event_intel")
        .select("event_id, calendar_event_ids, events!inner(name, user_id)")
        .eq("user_id", user!.id),
    ]);
    // A Supabase error is a RETURN VALUE. `data || []` here would render every
    // known person as "not on the roster" and invite Mason to create duplicates.
    for (const r of [crewRes, orgRes, mappedRes]) if (r.error) throw r.error;

    /** calendar entry id → the gallery that already claims it. */
    const claimedBy = new Map<string, { eventId: string; eventName: string }>();
    for (const row of mappedRes.data ?? []) {
      const ev = row.events as { name?: string } | null;
      for (const id of row.calendar_event_ids ?? []) {
        if (id) claimedBy.set(String(id), { eventId: row.event_id, eventName: ev?.name ?? "an event" });
      }
    }

    const crewByEmail = new Map<
      string,
      { id: string; display_name: string; kind: string | null; is_regular: boolean; archived: boolean }
    >();
    for (const c of crewRes.data ?? []) {
      for (const addr of [c.primary_email, ...(c.aliases ?? [])]) {
        if (addr) crewByEmail.set(String(addr).toLowerCase(), c);
      }
    }
    const orgByDomain = new Map<string, { id: string; name: string }>();
    for (const o of orgRes.data ?? []) {
      for (const d of o.domains ?? []) orgByDomain.set(String(d).toLowerCase(), o);
    }

    const out = shortlist.map(({ gig, score, shared, dayGap }) => {
      const parsed = gig.events.map(parseGig);
      const venueStr = parsed.map((p) => p.venue).find(Boolean) ?? null;
      const venue = venueStr ? parseVenue(venueStr) : null;

      /**
       * Dedupe by PERSON, not by address. Joey attends under both his company
       * and personal addresses, so keying on email listed "Joseph Nagoshiner,
       * Joseph Nagoshiner" — the duplication the alias merge exists to remove,
       * reappearing one layer up.
       */
      const seen = new Map<string, { crewId: string; name: string; isRegular: boolean; kind: string | null }>();
      const unresolved: { email: string; displayName: string | null }[] = [];
      for (const p of parsed) {
        for (const a of p.attendees) {
          const hit = crewByEmail.get(a.email);
          if (hit) {
            // An archived person who really was on the gig is still a fact, but
            // they are not a default — the create screen leaves them off.
            if (!seen.has(hit.id)) {
              seen.set(hit.id, {
                crewId: hit.id,
                name: hit.display_name,
                isRegular: !!hit.is_regular,
                kind: hit.kind ?? null,
              });
            }
          } else if (!unresolved.some((u) => u.email === a.email)) {
            unresolved.push({ email: a.email, displayName: a.displayName });
          }
        }
      }

      const domains = payerDomains(parsed.flatMap((p) => p.contactEmails));

      /**
       * EVERYTHING USER-FACING COMES FROM THE JOB ENTRY, NOT THE SET-UP.
       *
       * A grouped gig usually starts with its set-up day, and `groupIntoGigs`
       * takes its client and start from whichever entry opened the group. So
       * the obvious fields read "Appfolio Set Up" on 13 July for a job shot on
       * the 14th — seen in production, where picking that row named the gallery
       * "Appfolio Set Up" and dated it to the load-in.
       *
       * `start`/`end` stay the true RANGE, because the card shows the span and
       * the set-up day is genuinely part of it. What changes is the three
       * things that get copied INTO the event.
       */
      const jobIdx = parsed.findIndex((p) => p.kind === "gig");
      const job = jobIdx >= 0 ? { parsed: parsed[jobIdx], event: gig.events[jobIdx] } : null;
      const jobDay = (job?.event?.start?.date ?? job?.event?.start?.dateTime ?? "").slice(0, 10);

      return {
        /** Stable within a response; the client only needs to tell rows apart. */
        key: gig.events.map((e) => e.id).filter(Boolean).join("|") || `${gig.client}-${gig.start}`,
        client: job?.parsed.client ?? gig.client,
        title: job?.event?.summary ?? gig.events[0]?.summary ?? gig.client ?? "(untitled)",
        /** The day to date the gallery — the shoot, not the load-in. */
        shootDate: jobDay || gig.start,
        start: gig.start,
        end: gig.end,
        entryCount: gig.events.length,
        city: parsed.map((p) => p.city).find(Boolean) ?? venue?.city ?? null,
        venue: venue
          ? { name: venue.name, street: venue.street, city: venue.city, raw: venue.raw }
          : null,
        crew: [...seen.values()],
        /** Attendees with no roster row — shown as a count, never invented. */
        unresolvedCrew: unresolved,
        orgs: domains.map((d) => ({
          domain: d,
          orgId: orgByDomain.get(d)?.id ?? null,
          name: orgByDomain.get(d)?.name ?? null,
        })),
        calendarEventIds: gig.events.map((e) => e.id).filter(Boolean) as string[],
        /** The gallery that already claims this gig, when there is one. */
        alreadyIn:
          gig.events.map((e) => (e.id ? claimedBy.get(String(e.id)) : null)).find(Boolean) ?? null,
        score: Number(score.toFixed(3)),
        matchedOn: shared,
        dayGap,
      };
    });

    /**
     * Already-used gigs sink to the bottom, in their existing order.
     *
     * They stay pickable — see the comment on the query — but they should never
     * outrank a gig with no gallery yet, because the overwhelmingly common
     * reason you are on this screen is the one that has not been made.
     */
    out.sort((a, b) => Number(!!a.alreadyIn) - Number(!!b.alreadyIn));

    return NextResponse.json({ gigs: out, unavailable: null });
  } catch (err) {
    await reportSystemError("api.events.suggestGig.GET", err, {});
    return NextResponse.json({ error: "Could not look up the calendar" }, { status: 500 });
  }
}
