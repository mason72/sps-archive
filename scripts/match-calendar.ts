/**
 * Match Pixeltrunk events to calendar gigs, and populate Event Intel from them.
 *
 *   npx tsx scripts/match-calendar.ts                    # propose, write nothing
 *   npx tsx scripts/match-calendar.ts --apply            # write venue/crew/payer
 *   npx tsx scripts/match-calendar.ts --event <uuid>     # just one
 *   npx tsx scripts/match-calendar.ts --min-score 0.5    # loosen the threshold
 *
 * This is the same function the upload-time confirm card will call, run in bulk.
 * The backfill matches 1,371 collections; the card matches one. Building it once
 * is why the credential and the parser were worth doing first.
 *
 * ── What it will and will not do ────────────────────────────────────────────
 *
 * It SUGGESTS. Every row it writes is unconfirmed (`event_intel.confirmed_at` is
 * null) and every match carries the score and reasons that produced it. A human
 * confirming is what makes a fact; until then it is a good guess with its
 * working shown.
 *
 * It never overwrites a confirmed row. Confirmed data winning over a later
 * calendar edit is the rule that keeps the suggestions trustworthy — the moment
 * a re-run can clobber a correction, corrections stop being worth making.
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
const ONE_EVENT = flag("event");
const MIN_SCORE = Number(flag("min-score") ?? 0.45);
/** Days either side of the event date to consider. A multi-day gig can start before. */
const WINDOW_DAYS = Number(flag("window") ?? 4);

/**
 * Matches a human has confirmed by hand, keyed by archive event id.
 *
 * Some pairs are simply not derivable. "Jessica & Koji's Big Day" and the
 * calendar's "Jessica Owyang Wedding" are the same 2014 wedding — Mason
 * confirmed it — but they share one first name and score 0.32, and lowering the
 * threshold far enough to catch it would let a dozen wrong pairs through. A
 * confirmed match is recorded as fact, marked confirmed_at so no later run can
 * revisit it, rather than by weakening the rule that keeps the rest honest.
 */
const CONFIRMED_MATCHES: Record<string, string> = {
  // Jessica & Koji's Big Day, Aug 2014 — recovered from an old USB drive for
  // the client after her husband died.
  "b4f42922-0e30-48f9-8496-51b5a48db10b": "Jessica Owyang Wedding",
};

/**
 * The scoring now lives in `src/lib/event-intel/match-gig.ts`.
 *
 * It was written here, and it was the right place while the backfill was the
 * only caller. It is not: the create screen looks a gig up as the name is
 * typed, and the design promised from the start that the two would be the same
 * function — "the backfill calls it 1,371 times; the upload flow calls it
 * once". A copy here would be a second dialect of the rule that decides which
 * job a gallery is, and this repo's recurring failure is exactly that: a caller
 * that re-derives what another surface decides drifts from it silently.
 *
 * Imported inside `main` with everything else from `src/`, because the env file
 * has to be loaded before those modules initialise.
 */
async function main() {
  const { createServiceClient } = await import("../src/lib/supabase/server");
  const { norm, scoreNameAgainstClient: nameScore, daysApart } =
    await import("../src/lib/event-intel/match-gig");
  const { payerDomains } = await import("../src/lib/event-intel/apply-gig");
  const { listEvents, CALENDARS, STUDIO_CALENDARS } = await import("../src/lib/event-intel/google-calendar");
  const { parseGig, groupIntoGigs, parseVenue, venueKey, parseStudioSession } =
    await import("../src/lib/event-intel/parse-calendar");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createServiceClient() as any;

  console.log(APPLY ? "MODE: APPLY — writing unconfirmed suggestions\n" : "MODE: propose only\n");

  // ── the archive side ──
  let q = db.from("events").select("id, name, sort_date, event_date, user_id").order("sort_date", { ascending: false });
  if (ONE_EVENT) q = q.eq("id", ONE_EVENT);
  const { data: events, error: evErr } = await q;
  if (evErr) throw evErr;
  console.log(`${events.length} archive event(s)`);

  // ── the calendar side ──
  const allEntries = [];
  const studioEntries = [];
  for (const key of Object.keys(CALENDARS) as (keyof typeof CALENDARS)[]) {
    const evs = await listEvents(key, { timeMin: "2014-01-01T00:00:00Z" });
    if (STUDIO_CALENDARS.has(key)) studioEntries.push(...evs);
    else allEntries.push(...evs);
  }
  const gigs = groupIntoGigs(allEntries);

  /**
   * Studio bookings become single-entry pseudo-gigs.
   *
   * They cannot go through groupIntoGigs: there is no crew segment for it to
   * read, the "client" is a person rather than a company, and two unrelated
   * sittings on one afternoon must never merge into one gig the way a set-up and
   * its main day should.
   */
  for (const e of studioEntries) {
    const s = parseStudioSession(e);
    if (!s.isBooking || !s.clientName) continue;
    const day = (e.start?.date ?? e.start?.dateTime ?? "").slice(0, 10);
    if (!day) continue;
    gigs.push({ client: s.clientName, start: day, end: day, events: [e] });
  }
  console.log(`${allEntries.length} gig entries + ${studioEntries.length} studio entries → ${gigs.length} gigs\n`);

  // ── crew registry, for resolving attendees ──
  const { data: crew } = await db.from("crew").select("id, display_name, primary_email, aliases");
  const crewByEmail = new Map<string, { id: string; display_name: string }>();
  for (const c of crew ?? []) {
    for (const a of [c.primary_email, ...(c.aliases ?? [])]) if (a) crewByEmail.set(String(a).toLowerCase(), c);
  }

  // Existing venues, so a re-run reuses rather than duplicates.
  const { data: venueRows } = await db.from("venues").select("id, name, city");
  const venueByKey = new Map<string, string>();
  for (const v of venueRows ?? []) {
    venueByKey.set(`${norm(v.name ?? "")}|${(v.city ?? "").toLowerCase()}`, v.id);
  }

  const { data: orgRows } = await db.from("organizations").select("id, name, domains");
  const orgByDomain = new Map<string, string>();
  for (const o of orgRows ?? []) for (const d of o.domains ?? []) orgByDomain.set(String(d).toLowerCase(), o.id);

  let matched = 0, unmatched = 0, skippedConfirmed = 0;
  const report: string[] = [];

  /**
   * Shoot dates from the PHOTOS, not from the row.
   *
   * `sort_date` falls back to the creation date when `event_date` is null, and a
   * gallery is created days after the shoot — "Island HQ Headshot Day" sorts at
   * 08-12 for a job shot on 08-07, so a ±4 day window never saw it. `taken_at`
   * is the shutter time and is present on ~98% of images. One grouped query
   * rather than one per event.
   */
  const { data: shotRows } = await db.rpc("event_readiness", { p_event_ids: events.map((e: { id: string }) => e.id) })
    .then(() => ({ data: null })).catch(() => ({ data: null }));
  void shotRows;
  const shotDay = new Map<string, string>();
  for (const ev of events) {
    const { data: t } = await db
      .from("images").select("taken_at").eq("event_id", ev.id)
      .not("taken_at", "is", null).order("taken_at", { ascending: true }).limit(1);
    if (t?.[0]?.taken_at) shotDay.set(ev.id, String(t[0].taken_at).slice(0, 10));
  }

  for (const ev of events) {
    // Prefer the shutter date, then the hand-entered one, then creation.
    const day: string | null = shotDay.get(ev.id) ?? ev.event_date ?? ev.sort_date ?? null;
    if (!day) { unmatched++; report.push(`?  ${ev.name.slice(0, 40)} — no date to match on`); continue; }

    // Never clobber a human's work.
    const { data: existing } = await db
      .from("event_intel").select("event_id, confirmed_at").eq("event_id", ev.id).maybeSingle();
    if (existing?.confirmed_at) { skippedConfirmed++; continue; }

    const candidates = gigs
      .filter((g) => daysApart(g.start, day) <= WINDOW_DAYS || daysApart(g.end, day) <= WINDOW_DAYS)
      .map((g) => {
        const parsed = g.events.map(parseGig);
        const client = g.client ?? "";
        const ns = nameScore(ev.name, client);
        const dayGap = Math.min(daysApart(g.start, day), daysApart(g.end, day));
        // Date proximity is a tiebreak, not evidence on its own: several gigs a
        // week share a date and only the name says which one this gallery is.
        const score = ns.score * (dayGap === 0 ? 1 : dayGap <= 1 ? 0.95 : 0.85);
        return { gig: g, parsed, score, shared: ns.shared, dayGap, client };
      })
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);

    // A human's confirmation outranks any score.
    const forced = CONFIRMED_MATCHES[ev.id];
    const best = forced
      ? candidates.find((c) => norm(c.client ?? "") === norm(forced)) ?? candidates[0]
      : candidates[0];
    const isConfirmed = !!forced && !!best && norm(best.client ?? "") === norm(forced);

    if (!best || (!isConfirmed && best.score < MIN_SCORE)) {
      unmatched++;
      const near = candidates[0];
      report.push(
        `✗  ${ev.name.slice(0, 38).padEnd(40)} ${day}${shotDay.has(ev.id) ? "*" : " "} ` +
        (near ? `best "${near.client?.slice(0, 26)}" ${near.score.toFixed(2)}` : "no candidate in window")
      );
      continue;
    }

    matched++;
    const venueStr = best.parsed.map((p) => p.venue).find(Boolean) ?? null;
    const venue = venueStr ? parseVenue(venueStr) : null;
    const attendees = [...new Set(best.parsed.flatMap((p) => p.attendees.map((a) => a.email)))];
    /**
     * Dedupe by PERSON, not by address. Joey attends under both his company and
     * personal addresses, so keying on email listed "Joseph Nagoshiner, Joseph
     * Nagoshiner" — the very duplication the alias merge exists to remove,
     * reappearing one layer up.
     */
    const resolvedMap = new Map<string, { id: string; display_name: string }>();
    for (const e of attendees) {
      const hit = crewByEmail.get(e);
      if (hit) resolvedMap.set(hit.id, hit);
    }
    const resolved = [...resolvedMap.values()];
    // Shared with the create screen: one definition of "which domain names a
    // payer", so the two cannot start disagreeing about whether gmail counts.
    const contactDomains = payerDomains(best.parsed.flatMap((p) => p.contactEmails));

    report.push(
      `${isConfirmed ? "★" : "✓"}  ${ev.name.slice(0, 38).padEnd(40)} ${day}${shotDay.has(ev.id) ? "*" : " "} ${isConfirmed ? "conf" : best.score.toFixed(2)} "${(best.client ?? "").slice(0, 24)}" ` +
      `[${best.shared.join("+")}]\n` +
      `      venue: ${venue?.name ?? venue?.street ?? "—"}${venue?.city ? ` (${venue.city})` : ""}\n` +
      `      crew : ${resolved.map((r) => r.display_name).join(", ") || "—"}` +
      `${attendees.length > resolved.length ? `  (+${attendees.length - resolved.length} unresolved)` : ""}` +
      `${contactDomains.length ? `\n      payer: ${contactDomains.join(", ")}` : ""}`
    );

    if (!APPLY) continue;

    // ── venue ──
    let venueId: string | null = null;
    if (venue && (venue.name || venue.street)) {
      const key = venueKey(venue);
      venueId = venueByKey.get(key) ?? null;
      if (!venueId) {
        const { data: made, error: vErr } = await db.from("venues").insert({
          user_id: ev.user_id,
          name: venue.name ?? venue.street ?? venue.raw,
          address: venue.street, city: venue.city, region: venue.region, country: venue.country,
        }).select("id").single();
        if (vErr) console.error(`  venue: ${vErr.message}`);
        else { venueId = made.id; venueByKey.set(key, made.id); }
      }
    }

    // ── the intel row ──
    const { error: iErr } = await db.from("event_intel").upsert({
      event_id: ev.id,
      user_id: ev.user_id,
      venue_id: venueId,
      calendar_event_ids: best.gig.events.map((e: { id?: string }) => e.id).filter(Boolean),
      source: "calendar",
      // Only a human's confirmation sets this. Everything else stays a
      // suggestion, and a suggestion is re-derivable; a confirmation is not.
      ...(isConfirmed ? { confirmed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: "event_id" });
    if (iErr) console.error(`  intel: ${iErr.message}`);

    // ── crew ──
    for (const person of resolved) {
      /**
       * Role is left EMPTY for anyone whose pool is ambiguous.
       *
       * The calendar does not record who shot and who teched — they trade off
       * mid-gig, which is the whole reason role is a set. Filling it from the
       * person's pool would invent a fact: a PhotographersDT member could have
       * done either. Where the pool has exactly one role (a stylist, a makeup
       * artist) the inference is safe, and that is the only case we take.
       */
      const { error: cErr } = await db.from("event_crew").upsert({
        event_id: ev.id, crew_id: person.id, user_id: ev.user_id, roles: [],
      }, { onConflict: "event_id,crew_id" });
      if (cErr) console.error(`  crew: ${cErr.message}`);
    }

    // ── payer, from the onsite-contact domain ──
    for (const domain of contactDomains) {
      let orgId = orgByDomain.get(domain);
      if (!orgId) {
        const pretty = domain.replace(/\.(com|org|net|io|co)$/i, "").replace(/[-.]/g, " ");
        const { data: made, error: oErr } = await db.from("organizations").insert({
          user_id: ev.user_id,
          name: pretty.replace(/\b\w/g, (c) => c.toUpperCase()),
          domains: [domain],
        }).select("id").single();
        if (oErr) { console.error(`  org: ${oErr.message}`); continue; }
        orgId = made.id; orgByDomain.set(domain, made.id);
      }
      const { error: eoErr } = await db.from("event_orgs").upsert({
        event_id: ev.id, org_id: orgId, user_id: ev.user_id, role: "payer",
      }, { onConflict: "event_id,org_id,role" });
      if (eoErr) console.error(`  event_org: ${eoErr.message}`);
    }
  }

  console.log(report.join("\n"));
  console.log(`\n${matched} matched · ${unmatched} unmatched · ${skippedConfirmed} already confirmed (left alone)`);
  if (!APPLY) console.log("propose only — nothing written.");
  else console.log("written as UNCONFIRMED suggestions; confirming is a human's job.");
}

main().catch((err) => { console.error(err); process.exit(1); });
