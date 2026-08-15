import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * Event Intel for ONE event — the back-office view of who worked it and where.
 *
 * INTERNAL. This carries venue logistics, client structure and rebook
 * judgements about named people who do not work here. There is no share path
 * to it and there must never be one; every query below is scoped to the
 * authenticated owner, because `getAuthUser()` returns the SERVICE client and
 * RLS is bypassed (the omission that has shipped as an IDOR here twice).
 *
 * Why a per-event route when `/intel` already exists: the pivot answers "which
 * events did this PERSON work", and confirming an assignment is the opposite
 * question — "who worked THIS event, and is that right". Mason went looking for
 * it on the event page, which is where it belongs.
 */

/**
 * The role vocabulary and its shape rule live in `@/lib/event-intel/roles`.
 *
 * They were declared here, which was fine while this was the only writer. It
 * is not: the create screen writes assignments too, through `applyGigIntel`.
 * Two declarations of "what is a role and how many disciplines may someone
 * hold" is how one writer starts accepting stylist AND photographer while the
 * other rejects it — enforced in the API rather than only the UI, and therefore
 * worth having exactly one API-side definition.
 */
import {
  KNOWN_ROLES,
  REHIRE_LADDER,
  cleanConfirmedRoles,
  cleanRehire,
  cleanRoles,
  compareCrewForPicker,
  rehireStanding,
  standingVisibleFor,
} from "@/lib/event-intel/roles";

interface EventCrewRow {
  crew_id: string;
  roles: string[] | null;
  confirmed_roles: string[] | null;
  roles_source: string | null;
  would_rebook: string | null;
  note: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    // Ownership first: prove this event is the caller's before reading anything
    // hanging off it.
    const { data: event, error: evErr } = await db
      .from("events")
      .select("id, name, sort_date")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const [intelRes, crewLinkRes, orgLinkRes, rosterRes] = await Promise.all([
      db.from("event_intel").select("*").eq("event_id", eventId).eq("user_id", user!.id).maybeSingle(),
      db.from("event_crew").select("*").eq("event_id", eventId).eq("user_id", user!.id),
      db.from("event_orgs").select("*").eq("event_id", eventId).eq("user_id", user!.id),
      db.from("crew").select("id, display_name, full_name, primary_email, kind, city, can_lead, is_regular")
        .eq("user_id", user!.id).eq("archived", false)
        // Regulars first — the picker shows this order as it arrives.
        .order("is_regular", { ascending: false }).order("display_name"),
    ]);
    for (const r of [intelRes, crewLinkRes, orgLinkRes, rosterRes]) {
      // A Supabase error is a RETURN VALUE — `data || []` would render an empty
      // panel that looks exactly like an event with no crew recorded.
      if (r.error) throw r.error;
    }

    const intel = intelRes.data;
    let venue = null;
    if (intel?.venue_id) {
      const { data: v, error: vErr } = await db
        .from("venues").select("*").eq("id", intel.venue_id).eq("user_id", user!.id).maybeSingle();
      if (vErr) throw vErr;
      venue = v;
    }

    const orgIds = (orgLinkRes.data ?? []).map((o: { org_id: string }) => o.org_id);
    let orgs: { id: string; name: string; kind: string }[] = [];
    if (orgIds.length) {
      const { data: o, error: oErr } = await db
        .from("organizations").select("id, name, kind").in("id", orgIds).eq("user_id", user!.id);
      if (oErr) throw oErr;
      orgs = o ?? [];
    }
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const roster = rosterRes.data ?? [];
    const rosterById = new Map(roster.map((c: { id: string }) => [c.id, c]));

    /**
     * Every rating each of these people has ever received, newest first.
     *
     * One grouped query for the whole roster rather than one per person — the
     * same rule the dashboard learned the hard way about embedded counts on a
     * hot table. `event_crew` is small (40 links today) and this is bounded by
     * the roster, not by the archive.
     */
    const { data: allRatings, error: ratErr } = await db
      .from("event_crew")
      .select("crew_id, would_rebook, created_at")
      .eq("user_id", user!.id)
      .not("would_rebook", "is", null)
      .order("created_at", { ascending: false });
    if (ratErr) throw ratErr;

    const ratingsByCrew = new Map<string, string[]>();
    for (const r of allRatings ?? []) {
      const list = ratingsByCrew.get(r.crew_id) ?? [];
      list.push(r.would_rebook);
      ratingsByCrew.set(r.crew_id, list);
    }
    const standingFor = (crewId: string) => rehireStanding(ratingsByCrew.get(crewId) ?? []);

    return NextResponse.json({
      event: { id: event.id, name: event.name, date: event.sort_date },
      confirmed: !!intel?.confirmed_at,
      notes: intel?.notes ?? null,
      source: intel?.source ?? null,
      venue: venue
        ? { id: venue.id, name: venue.name, address: venue.address, city: venue.city, region: venue.region, notes: venue.notes }
        : null,
      // ALPHABETICAL, always. `event_crew` has no name column to ORDER BY, and
      // Postgres guarantees no order without one — so after any write the rows
      // can come back rearranged and names visibly jump. Sorted here, after the
      // join, because this is the first point where the name exists.
      crew: (crewLinkRes.data ?? [])
        .map((r: EventCrewRow) => {
        const person = rosterById.get(r.crew_id) as
          | { display_name: string; kind: string; city: string | null; can_lead: string | null; is_regular: boolean }
          | undefined;
        return {
          crewId: r.crew_id,
          name: person?.display_name ?? "(not on the roster)",
          kind: person?.kind ?? null,
          isRegular: !!person?.is_regular,
          homeCity: person?.city ?? null,
          canLead: person?.can_lead ?? null,
          roles: r.roles ?? [],
          /**
           * The subset Mason has actually endorsed. Per-ROLE, because
           * confirming one used to confirm every other guess on the row: he
           * clicked "lead" on Joey and silently blessed "photographer" too.
           */
          confirmedRoles: r.confirmed_roles ?? [],
          // Row-level provenance, still useful for "has this been looked at".
          rolesSource: r.roles_source ?? "manual",
          wouldRebook: cleanRehire(r.would_rebook),
          note: r.note ?? null,
          /**
           * Their standing across every OTHER gig — revealed only once this
           * event has its own rating.
           *
           * Mason: show ratings "on events AFTER they've been rated to
           * eliminate bias". Seeing "First call ×4" while deciding today's
           * rating is an invitation to agree with yourself, and an independent
           * judgement per gig is the entire value of the data.
           */
          standing: standingVisibleFor(r.would_rebook) ? standingFor(r.crew_id) : null,
        };
        })
        .sort((a: { name: string; isRegular: boolean }, b: { name: string; isRegular: boolean }) =>
          a.name.localeCompare(b.name, "en", { sensitivity: "base" })
        ),
      orgs: (orgLinkRes.data ?? []).map((r: { org_id: string; role: string }) => ({
        orgId: r.org_id,
        name: orgById.get(r.org_id)?.name ?? "(unknown)",
        role: r.role,
      })),
      knownRoles: KNOWN_ROLES,
      rehireLadder: REHIRE_LADDER,
      /**
       * The picker's roster, with "never again" sunk to the bottom.
       *
       * The database ORDER BY cannot express this — `hardNo` comes from
       * `event_crew` rows, not a `crew` column — so it is sorted here, through
       * the one comparator every picker shares.
       */
      roster: roster
        .map((c: { id: string; display_name: string; kind: string; city: string | null; is_regular: boolean }) => {
          const s = standingFor(c.id);
          return {
            id: c.id,
            name: c.display_name,
            kind: c.kind,
            homeCity: c.city,
            isRegular: !!c.is_regular,
            hardNo: s.hardNo,
            standing: s.total > 0 ? s : null,
          };
        })
        .sort(compareCrewForPicker),
    });
  } catch (err) {
    await reportSystemError("api.events.intel.GET", err, { eventId });
    return NextResponse.json({ error: "Could not load event intel" }, { status: 500 });
  }
}

/**
 * PATCH — confirm or correct one person's assignment.
 *
 * Body: { crewId, roles?, wouldRebook?, note? }  or  { crewId, remove: true }
 *       { addCrewId }  to attach someone from the roster
 *
 * Any write here is a HUMAN decision, so `roles_source` becomes 'manual' and
 * the calendar backfill will never overwrite it again. That is the whole point
 * of the column: a guess the machine may revise, versus a fact it may not.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const db = supabase as any;

    const { data: event, error: evErr } = await db
      .from("events").select("id").eq("id", eventId).eq("user_id", user!.id).maybeSingle();
    if (evErr) throw evErr;
    if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const body = (await request.json()) as {
      crewId?: string;
      addCrewId?: string;
      /** Attach an existing venue, or `null` to detach. */
      venueId?: string | null;
      /** Create a venue and attach it in one step. */
      newVenue?: { name?: string; address?: string; city?: string };
      /** Edit the venue already attached. */
      venuePatch?: { name?: string; address?: string; city?: string; notes?: string };
      remove?: boolean;
      roles?: string[];
      confirmedRoles?: string[];
      wouldRebook?: string | null;
      note?: string | null;
      eventNotes?: string;
    };

    /**
     * Venue, from the event page.
     *
     * 10 of 17 venues are named by their street address, because the calendar
     * gave no venue name. The place that gets noticed is the event you are
     * looking at, so naming one has to be possible from here rather than only
     * on /intel.
     */
    if (body.newVenue?.name?.trim()) {
      const { data: v, error: vErr } = await db.from("venues").insert({
        user_id: user!.id,
        name: body.newVenue.name.trim(),
        address: body.newVenue.address?.trim() || null,
        city: body.newVenue.city?.trim() || null,
      }).select("id").single();
      if (vErr) {
        if (String(vErr.code) === "23505") {
          return NextResponse.json({ error: "You already have a venue with that name" }, { status: 409 });
        }
        throw vErr;
      }
      // The intel row may not exist yet — upsert rather than assume.
      const { error } = await db.from("event_intel").upsert(
        { event_id: eventId, user_id: user!.id, venue_id: v.id, updated_at: new Date().toISOString() },
        { onConflict: "event_id" }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true, venueId: v.id });
    }

    if (body.venuePatch) {
      const { data: intel, error: iErr } = await db
        .from("event_intel").select("venue_id").eq("event_id", eventId).eq("user_id", user!.id).maybeSingle();
      if (iErr) throw iErr;
      if (!intel?.venue_id) return NextResponse.json({ error: "No venue attached" }, { status: 400 });

      const vp: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (typeof body.venuePatch.name === "string" && body.venuePatch.name.trim()) vp.name = body.venuePatch.name.trim();
      if (typeof body.venuePatch.address === "string") vp.address = body.venuePatch.address.trim() || null;
      if (typeof body.venuePatch.city === "string") vp.city = body.venuePatch.city.trim() || null;
      if (typeof body.venuePatch.notes === "string") vp.notes = body.venuePatch.notes.trim() || null;

      // Scoped to the owner: the venue id came from our own row, but a PATCH
      // body is still input.
      const { error } = await db.from("venues").update(vp).eq("id", intel.venue_id).eq("user_id", user!.id);
      if (error) {
        if (String(error.code) === "23505") {
          return NextResponse.json({ error: "Another venue already has that name" }, { status: 409 });
        }
        throw error;
      }
      return NextResponse.json({ ok: true });
    }

    if (typeof body.eventNotes === "string") {
      const { error } = await db.from("event_intel").upsert(
        { event_id: eventId, user_id: user!.id, notes: body.eventNotes, updated_at: new Date().toISOString() },
        { onConflict: "event_id" }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.addCrewId) {
      // Verify the person is on the caller's own roster before linking them.
      const { data: person, error: pErr } = await db
        .from("crew").select("id").eq("id", body.addCrewId).eq("user_id", user!.id).maybeSingle();
      if (pErr) throw pErr;
      if (!person) return NextResponse.json({ error: "Not on your roster" }, { status: 400 });

      const { error } = await db.from("event_crew").upsert(
        {
          event_id: eventId, crew_id: body.addCrewId, user_id: user!.id,
          roles: [], roles_source: "manual",
        },
        { onConflict: "event_id,crew_id" }
      );
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (!body.crewId) return NextResponse.json({ error: "crewId required" }, { status: 400 });

    if (body.remove) {
      const { error } = await db.from("event_crew").delete()
        .eq("event_id", eventId).eq("crew_id", body.crewId).eq("user_id", user!.id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    const patch: Record<string, unknown> = { roles_source: "manual" };
    if (body.roles) {
      const clean = cleanRoles(body.roles);
      patch.roles = clean;
      patch.confirmed_roles = cleanConfirmedRoles(body.confirmedRoles, clean);
    }
    // The rehire ladder, normalised in ONE place — legacy yes|maybe|no still
    // maps forward, so an old row keeps meaning something.
    if (body.wouldRebook !== undefined) patch.would_rebook = cleanRehire(body.wouldRebook);
    if (body.note !== undefined) patch.note = body.note?.slice(0, 2000) || null;

    const { error } = await db.from("event_crew").update(patch)
      .eq("event_id", eventId).eq("crew_id", body.crewId).eq("user_id", user!.id);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.events.intel.PATCH", err, { eventId });
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
