# Event Intel — venues, crew, clients, and the pivot over them

Status: **designed, not started.** Interview 2026-08-13. Nothing built.

Back-office metadata on an event: where it happened, who worked it, who the client was,
and what we want to remember. Never visible to a client — internal only.

## The job to be done

1. **Quality control.** Which crew worked which gigs, so a pattern is visible.
2. **Institutional memory about venues.** We work the same rooms repeatedly and forget
   the loading dock, the power situation, the security lead time.
3. **Rehire decisions on local hires.** "Great, book again" / "never again", attached to
   a person who can actually be identified next time.
4. **Investigation.** Look up a person, a venue, a city, a client — and see everything.

## The decisions (Mason, 2026-08-13)

- **Mason fills it in now; the model assumes crew accounts later.** Everyone currently
  shares the `info@twodudesphoto.com` login, so there is no per-user identity today.
  Design for it so adding accounts is additive rather than a migration.
- **Roles are a SET per person per event**, chosen from a lookup list, never free text.
  Photographers and digital techs trade off during a gig, so one person genuinely holds
  both on one event. A merged "photo+DT" role would destroy exactly the question the
  feature exists to answer ("who is strong on digital tech"), so the pairing is a
  one-tap ENTRY preset that ticks two boxes — the UI shortcut must not become the data
  model. Multiple people may hold `lead` on one event (more than one booth), so `lead`
  is not a singleton and the staffing query must never assume it is.
- **Non-goals for v1:** shift/time-segment modelling ("who traded off when"), and
  booth/station attribution. Both are real, both make the after-gig form miserable.
  Revisit only if the pivot makes us want them.
- **History comes from Google Calendar, imported once.** Pixeltrunk is the system of
  record afterwards.

## Why the calendar changes everything

Two calendars carry 12 years of gigs, already structured:

- `Two Dudes Gigs` — `6jhfih8prj4erj9aspsv7au7gc@group.calendar.google.com`. **Photo
  booth jobs** (Mason). Verified back to **2014**.
- `Two Dudes EXPOSURE` — `out00v9tpf06eldqsquh8m8d7s@group.calendar.google.com`.
  **Headshot and event photography** — the side most Pixieset collections come from, so
  the primary source for this backfill.

A real record, the 2018 Perkin Elmer gig that is also Pixieset collection `11139225`:

```
summary:     JOEY & JERRICK & CRISTINA & CARI  //  Perkin Elmer SKO  //  Scottsdale
location:    The Scottsdale Plaza Resort
attendees:   jerrickmitra@gmail.com, cari@caricourtright.com,
             tinasfl06@hotmail.com, joeynags@gmail.com
description: ONSITE CONTACT / SCHEDULE / FREIGHT / DATA CAPTURE / PRINTS /
             SAVE FOLDER: \\2018-02-12 Perkin_Elmer_Headshots / SHARING
```

That one record carries venue, crew, client, city, and a folder name that joins to both
the Dropbox archive (`YYMMDD Client Name`) and the Pixieset collection. The title
pattern is `CREW & CREW // Client // City`. Descriptions split naturally along the line
this design already wanted: load-in/parking/power are **venue** truths, schedule and
onsite contacts are **event** facts.

**Attendee email is the canonical crew key.** `joeynags@gmail.com` appears with no
display name, while a flight on the same trip reads `NAGOSHINER/JOSEPH` — one human,
three spellings, one stable id. This is the Joey/Joseph/Joe problem, already solved by
the data we have, for free, across the whole history.

Consequence: **v1 is mostly extraction, canonicalisation and a pivot view — not a data
entry form.** The form is a thin editor for corrections and for what the calendar never
captured (rebook ratings, quality notes).

### What the calendar does NOT give us

- Rebook ratings and quality judgements. Those are new.
- Clean crew/client separation — attendees are a mix. Needs one human pass.
- Noise: flights, BNI meetings, availability blocks. Gigs need a filter (has attendees
  AND has location AND title matches the crew//client pattern is a good start).

### What was ruled out, with evidence

- **GPS auto-detection of venues is impossible here.** Measured: **0 of 30,178 images**
  carry `gps_lat`. Every body in the kit is a pro camera that does not record it —
  Canon R1/R3/1DX, Phase One IQ3/IQ4, Leica Q3. EXIF is otherwise healthy
  (`taken_at` 97.6%, `camera_model` 97.2%). Do not revisit this.
- **Venue from event names is not viable.** 11.8% of the 1,371 Pixieset collection names
  contain a known city, and most of those are false positives (`Maggie & Charlie` → "dc"
  from a substring). Names are rich in CLIENT (Microsoft, eBay, Hitachi Vantara, Pure
  Storage) and poor in venue.

## Suggest-and-confirm at upload (Mason, 2026-08-13) — the thing that makes it stick

> "If the Pixeltrunk connection can look at the calendar and suggest locations and leads
> and roles and then the crew member who's uploading the event can simply confirm it…
> my sense is that it would significantly increase the completion rate of this data."

He is right, and this is the feature, not a nicety. A blank form after a 12-hour day
gets filled in never; a pre-filled card with a Confirm button gets filled in always. It
is the difference between this dataset existing and not existing.

**It is also nearly free, because it is the same code.** Matching one Pixeltrunk event
to one calendar gig — by date and client-name similarity, then parsing crew, venue,
city and roles out of the title/attendees/description — is one function. The backfill
calls it 1,371 times; the upload flow calls it once. Build it as a shared library and
both callers are thin.

What genuinely IS new work, and should be costed honestly:

1. **The app needs its own Google Calendar credential.** The backfill can run through an
   agent session's calendar access; a live suggestion inside Pixeltrunk cannot. That
   means OAuth or a service account with domain-wide delegation, token storage and
   refresh. This is the real cost — call it a day — and it is the only part that would
   not exist in the import-once version.
2. **A precedence rule.** Once a human confirms, confirmed data wins and is never
   silently overwritten by a later calendar edit. Re-suggest only where nothing has been
   confirmed, and surface a diff rather than clobbering.
3. **Match on `images.taken_at`, not `events.event_date`.** The hand-entered date is
   NULL on 7 of 19 live events (see CLAUDE.md); `taken_at` is present on 97.6% of images
   and is the actual shutter date. Deriving the day in LOCAL time matters here for the
   same reason it does for the guest-list link.

Note this is effectively the "import once, then keep syncing" option rather than the
pure import chosen above — deliberately, because the confirm flow is what drives
completion. The ongoing connection is in scope.

## Schema sketch

```
venues        id, name, place_id?, address, city, region, country, lat, lng, notes
crew          id, canonical_name, kind(staff|local|client|other), email, aliases[], notes
clients       id, name, aliases[]
roles         id, name           -- lookup: photographer, digital tech, stylist, makeup
event_intel   event_id, venue_id, client_id, source(calendar|manual), calendar_event_id
event_crew    event_id, crew_id, roles[], would_rebook(yes|no|maybe)?, note
venue_notes   venue_id, body, created_at            -- permanent truths
```

Two note homes on purpose. A venue note is true until it changes; an event note is about
one gig. Merged, the venue page becomes a chronological pile nobody reads.

## Bespoke or general? Generic tables, bespoke ingestion (Mason's instinct, refined)

Mason's instinct is to build this for Two Dudes only. Right on scope — but the split
that matters is not "bespoke vs general", it is **which layer** is bespoke.

- **The schema is generic and user-scoped, and that is not a generality tax — it is the
  app's security invariant.** Every table here is scoped by `user_id`, and
  `getAuthUser()` hands back the SERVICE client which bypasses RLS, so every query needs
  an ownership filter (CLAUDE.md; this exact omission shipped as an IDOR twice).
  A deliberately single-tenant table with no `user_id` would be *more* work and would be
  the next IDOR. So scope it properly from the first migration — which incidentally
  leaves the door open for nothing extra.
- **The ingestion is bespoke and should stay that way.** Two hardcoded calendar ids, the
  `CREW & CREW // Client // City` title convention, and the `** ONSITE CONTACT / **
  BACKDROP / ** LOAD IN` description sections are Two Dudes habits, not an industry
  standard. Do not try to write a general calendar parser.
- **The expensive parts of a general version are the ones we are deferring anyway:**
  not assuming Google Calendar, not assuming a title convention, and needing real venue
  search (Places) instead of a curated list. If this ever earns a wider release, other
  users get the same tables with manual entry, and the Two Dudes calendar importer stays
  an adapter.

## Safety — this is personnel data

"Do not hire this person again" concerns named individuals who are usually not
employees and often work for competitors. If it leaked it is genuinely damaging.

- **Structurally unreachable from any share or guest path.** Same rule as the guest-list
  token: it is not "hidden in the UI", it must not be resolvable from a share slug, a
  gallery payload, or any route that answers without a session.
- **Prefer structured over prose** for judgements (`would_rebook` + tags), with prose
  secondary. More filterable and more defensible.
- With a shared team login there is no author attribution today. When crew accounts
  arrive, notes get authors and rebook notes should be visible to leads only.

## Plan

- [ ] **1. Measure the match rate.** Pull both calendars, filter to gigs, match against
      the 1,371 Pixieset collections + existing events by date ± window and client-name
      similarity. Report coverage by year. This number decides how ambitious the rest is.
- [ ] **2. Extract the distinct attendee set.** Every email across both calendars, with
      the display names seen for each and the gig count. Propose canonical name + kind.
- [ ] **3. Identity confirmation pass.** Mason confirms/corrects in bulk — the one task
      that genuinely needs him, and it is the foundation for everything else.
- [ ] **4. Venue canonicalisation.** Cluster the `location` strings (many are already
      clean: "Grace Cathedral", "The Scottsdale Plaza Resort"; some are full addresses).
      Decide then whether Google Places is worth a key and its per-lookup cost, or
      whether a curated own-list is enough. Do not pay for it before we know.
- [ ] **5. Migration + import.** Tables above, then the one-time import behind a dry run.
- [ ] **6. The event editor.** Thin: venue picker, crew multi-select with roles, client,
      the two note fields. Fast enough to fill in after a 12-hour day.
- [ ] **7. The pivot.** One search box resolving to person / venue / city / client, each
      to a profile with cross-links.
- [ ] **8. The payoff query — "who should I staff for this?"** Given venue + client +
      date, rank crew by worked-here-before, rebook rating, recency. This is the thing
      that makes people keep it filled in, because it is useful BEFORE a gig, not just
      after.

## Open questions

- Google Places: worth the dependency and cost, or is a curated venue list enough?
  Decide after step 4, not before.
- Do we want the Two Dudes clients app / invoice history as a second source for the
  client dimension? Mason mentioned it; not yet examined.
