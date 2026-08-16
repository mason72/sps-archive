# Event Intel — venues, crew, clients, and the pivot over them

Status: **live.** Designed and sampled 2026-08-13; the pivot (`/intel`), the
create-screen gig confirm, the SPS-import gig confirm, the rehire ladder, the
roster editor, the radius search and crew faces (`tasks/crew-faces.md`) all
shipped 2026-08-13 → 2026-08-15. Sections below record the design and its
reasoning; where a decision changed in the building, the later note wins —
"digital tech" was removed from the role vocabulary 2026-08-15 (it named a
shift, not a person), and access is now gated per account
(`src/lib/event-intel/access.ts`, lesson 85).

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

### Coverage and matching, sampled live 2026-08-13

Spot-checked Pixieset collections against the calendars rather than assuming:

| | |
|---|---|
| `Two Dudes Gigs` earliest | **2014-05** (verified) |
| `Two Dudes EXPOSURE` earliest | **~2016-09** — nothing between 2015-01 and 2016-09-06 |
| `AXOS BANK DC // 2023` (2023-08-17) | **exact match**, 3 calendar entries, full intake form |
| `Perkin Elmer` (2018-02-12) | **exact match**, venue + 4 crew + save-folder name |
| `BoxWorks 2014 Headshots` (2014-09) | **no EXPOSURE event** — before that calendar existed |

So headshot/event work from **2016-09 onward is well covered**; 2014, 2015 and most of
2016 (~100 collections, ~7% of the keep set) will only be found in Gigs, if at all.

**Three matching rules this sampling produced, each of which would otherwise have been a
silent bug:**

1. **It is N calendar events to ONE collection, not 1:1.** The Axos gig is three
   entries — "Set Up for Axos Bank Headshots" on the 16th, the headshots on the 17th,
   and the evening at the Smithsonian. Group calendar events into a *gig* first (same
   client, contiguous dates), then match the gig to the collection. A 1:1 matcher would
   pick one arbitrarily and drop the crew who only appear on the others.
2. **One person has several email addresses, and one of them is current.**
   `joey@twodudesphoto.com` and `joeynags@gmail.com` are both attendees on the *same*
   event — one human. Mason (2026-08-13): the `@twodudesphoto.com` address is the
   up-to-date one, personal Gmail is legacy and being phased out, and **the same is true
   for Stretch, Jerrick and Justin** — staff who used personal addresses before getting
   company ones. So a person needs a `primary_email` (prefer `@twodudesphoto.com`) plus
   `aliases[]`, not just a set of equal addresses.

   **⚠️ This kills the "work domain ⇒ staff" shortcut, which an earlier draft of this
   doc proposed.** The classification belongs to the PERSON, not the address. Applied
   per-record it would read Joey as a local hire in 2018 and staff in 2023 — the same
   human, reclassified by the year, which would quietly corrupt every "which staff worked
   this venue" answer. Classify after merging, once, on the person.

   Known seed merges (Mason, 2026-08-13) — start the identity pass with these already
   proposed, and expect more of the same shape:

   | person | current | legacy seen in the calendars |
   |---|---|---|
   | Joey Nagoshiner | `joey@twodudesphoto.com` | `joeynags@gmail.com` |
   | Jerrick Mitra | `jerrick@twodudesphoto.com` | `jerrickmitra@gmail.com` |
   | Stretch | `@twodudesphoto.com` | personal address, to confirm |
   | Justin (Heller?) | `@twodudesphoto.com` | `isteratter@gmail.com` seen 2018 |

   **Nicknames are first-class.** "Stretch" is what the team calls him and therefore what
   Mason will search for, and it matches neither an email local-part nor a legal name.
   The registry needs a `display_name` (what we call them) alongside `full_name` — the
   pivot should show and search the former.

   Merges get **proposed and confirmed, never applied automatically.** Co-attendance on
   one event plus a local-part/display-name resemblance is strong evidence, not proof —
   two different people can legitimately both be on a gig.
3. **The onsite-contact email resolves the payer.** The Axos record carries
   `mtran@axosbank.com`, and `axosbank.com` has 19 invoices in the PandaDoc export. That
   is the join between the calendar and the money.

Also: `displayName` is populated on many attendees ("Joey Nagoshiner"), so the identity
pass can *propose* canonical names rather than asking Mason to type them — he confirms.

Description quality improves sharply over time. 2014–2018 is freeform prose with `**
SECTION` headers; 2023 is a structured intake form (Event Name, Event Location, Onsite
Contact, Backdrop, Load-out…) pasted from a Typeform. Parse both, but expect the recent
years to yield far more fields.

**The bulk backfill should use the Google Calendar API directly, not the agent's MCP
tools.** Descriptions run to several KB each and there are thousands of events; pulling
them through a conversation is the wrong tool. This is the same credential needed for
suggest-and-confirm, so it pays for itself twice.

### The roster spreadsheet is the other half of identity

`1VYdBVOc6pzayjJyt2xulKeG2LWUf1HO3vVHfuAAC7ns` — "2 Dudes Roster", four sheets, ~99
people with email addresses. Pull it without touching Drive's UI:
`https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx` in the logged-in
browser downloads it straight to ~/Downloads.

| sheet | people |
|---|---|
| `PhotographersDT` | ~51 |
| `Stylists` | ~42 |
| `SLC Recs from Cory` | ~4 |
| `MUA` | ~2 |

Columns on the main sheet: `First Name, Middle Name, Last Name, Email, Cell Phone,
Lead, Traveler, City, Region, Notes, PayPal, Venmo`, plus grouped sections for Role,
LOCATION, Archived, PAYMENT INFO and TRAVEL INFO.

**This is the crew registry, already built.** The calendars supply stable *emails*; the
roster supplies *canonical names, nicknames, city and capability*. Joined on email, the
identity pass stops being data entry and becomes a review of pre-filled rows.

Things it gives us that this design had not asked for and should use:

- **`Lead` (Yes/Maybe/No)** — a capability rating that already exists. Feeds the staffing
  query directly, and means `lead` is both a per-event role AND a standing capability.
  Keep them separate: "can lead" is about the person, "led this gig" is about the event.
- **`Traveler`** — whether they will travel. Essential to "who should I staff for this?"
  once the venue is out of town.
- **`City` / `Region`** — where each person is based, which is what makes local-hire
  matching possible and gives the city pivot a second dimension (worked-in vs based-in).
- **`Archived`** — active vs former, so the staffing query stops suggesting people who
  have moved on.
- **The sheet name IS the pool**: PhotographersDT, Stylists, MUA. Note it is one combined
  photographer/DT sheet — the pairing is how Mason thinks of the POOL, while the role on
  a given event stays a set. Those reconcile; do not collapse the per-event role to match
  the sheet.
- **`SLC Recs from Cory`** — a city-specific recommendation list, i.e. the local-hire
  concept already in practice, sourced by referral.

PayPal/Venmo/phone are PII with no place in this feature. Import name, email, role pool,
city, region, lead, traveler and archived; leave payment and contact details in the
sheet.

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

1. ~~**The app needs its own Google Calendar credential.**~~ **DONE 2026-08-13.** The backfill can run through an
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
roles         id, name           -- lookup: photographer, digital tech, stylist, makeup
event_intel   event_id, venue_id, source(calendar|manual), calendar_event_id
organizations id, name, domains[], kind(agency|brand|venue_host|individual)
event_orgs    event_id, org_id, role(payer|end_brand|host)   -- NOT a client_id column
event_crew    event_id, crew_id, roles[], would_rebook(yes|no|maybe)?, note
venue_notes   venue_id, body, created_at            -- permanent truths
```

Two note homes on purpose. A venue note is true until it changes; an event note is about
one gig. Merged, the venue page becomes a chronological pile nobody reads.

## "Client" is three different companies — and the payer is the one we want

Mason, 2026-08-13: an event can be *at* Autodesk University, *for* Intel, and *paid for*
by the events agency that hired us. All three are real, and the one to capture as the
client is **whoever pays**.

So do not put a `client_id` on the event. Mirror the crew model exactly — an
**`organizations` registry plus a ROLE on the event**:

```
organizations   id, name, domains[], kind(agency|brand|venue_host|individual)
event_orgs      event_id, org_id, role(payer | end_brand | host)
```

Same shape as people-and-roles, same reasoning, and it means "show me everything we did
for Intel" and "show me everything Opus Agency hired us for" are both answerable without
either fact overwriting the other.

**Email domain is the canonical key for an organisation**, exactly as email is for a
person. `opusagency.com` → Opus Agency, regardless of how the event was titled.

### The invoice export makes the payer dimension real for 2022→2026

`~/Projects/TDP/tdp-books/data/Invoices-2022-06-14-2026-06-13.csv` — a **PandaDoc**
export (not QuickBooks itself), 1,403 rows, already on disk. Measured 2026-08-13:

- **837 distinct recipients across 401 email domains.** The domains separate agency from
  direct exactly as Mason described: `launchinc.com` (39), `opusagency.com` (26),
  `typeaevents.com` (15), `streamlinevents.com` (15), `eventstudio.com` (14) are
  agencies; `purestorage.com` (25), `axosbank.com` (19), `docusign.com` (18),
  `collegeboard.org` (18), `stanford.edu` (16) are end brands buying direct.
- `gmail.com` (62) carries no signal, and `twodudesphoto.com` (33) is internal and must
  be excluded or it becomes our own biggest "client".
- **`Document Name` parses 95% of the time**: `TDP Invoice for <Client> // <Month Year>
  (Balance)`. Client, event and month in one string — a second matching key alongside
  the calendar.

**Coverage limit: this file starts 2022-06.** Pre-2022 payers are not in it. Live QBO
credentials exist in `tdp-books/.env` (`QBO_CLIENT_ID` etc.) but the token file at
`QBO_TOKEN_PATH` is absent on this machine, so the API is not currently authenticated.

**Recommendation: do not integrate QuickBooks.** A one-time CSV export is enough for a
backfill, and an OAuth integration for a dimension that changes a few times a month is
cost without benefit. If pre-2022 payers matter, the cheap move is a second export from
QuickBooks covering 2014–2022, not an API.

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

## Credential — connected 2026-08-13

Service account **`tdp-calendar@careful-bridge-499801-a2.iam.gserviceaccount.com`**
(project `careful-bridge-499801-a2`, "My First Project"). It already existed and the
Calendar API was already enabled — only a new private key and one calendar share were
needed.

- Key at `.google-calendar-key.json`, mode 600, gitignored. Also accepted inline via
  `GOOGLE_CALENDAR_KEY` for Vercel, or `GOOGLE_CALENDAR_KEY_FILE` for a different path.
- **EXPOSURE was already shared** with the service account. **Gigs was not** (404) and
  now is, at "See all event details" — read-only, which is all this ever needs.
- No SDK: the service-account flow is a signed JWT exchanged for a token, ~30 lines with
  `node:crypto`, against `googleapis` which is ~50 MB of every Google API.
- `checkAccess()` exists because forgetting to share a calendar fails as an EMPTY RESULT
  rather than an error, and a backfill that silently finds nothing looks exactly like a
  backfill with nothing to find.
- An older key (Jun 2026) is still active and its private half is not on this machine.
  Worth deleting in the console once this is settled.

## Plan

- [x] **1. Sample the match rate.** Done 2026-08-13 — see "Coverage and matching" above.
      2016-09 onward looks well covered; 2014–mid-2016 is not in EXPOSURE. A FULL match
      rate still needs a bulk pull, which should wait for the API credential rather than
      being done through MCP.
- [ ] **2. Extract the distinct attendee set.** Every email across both calendars, with
      the display names seen for each and the gig count. Propose canonical name + kind.
- [ ] **3. Identity confirmation pass.** Mason confirms/corrects in bulk — the one task
      that genuinely needs him, and it is the foundation for everything else.
- [ ] **4. Venue canonicalisation.** Cluster the `location` strings (many are already
      clean: "Grace Cathedral", "The Scottsdale Plaza Resort"; some are full addresses).
      Decide then whether Google Places is worth a key and its per-lookup cost, or
      whether a curated own-list is enough. Do not pay for it before we know.
- [ ] **4b. Payer dimension from the invoice export.** Parse `Document Name` and
      recipient domains out of the PandaDoc CSV, build the `organizations` registry
      keyed on domain, classify agency vs brand, and match to events by client + month.
      Covers 2022-06 onward; decide then whether a pre-2022 QuickBooks export is worth
      pulling.
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

---

## Built 2026-08-13 — `/intel`, the pivot

`src/app/intel/` (page + `IntelBoard`), reading `buildIntelIndex()`
(`src/lib/event-intel/index-intel.ts`). Fixture playground at `/dev/intel`,
dev-only.

**One fact table, four axes.** The event — with its venue, crew and
organisations attached — read along people / venues / cities / clients. This is
what makes a person's venues, a venue's crew and a city's clients incapable of
disagreeing: they are the same pass. `scripts/triage/intel-probe.ts` asserts the
person↔venue reciprocity rather than assuming it.

It reads whole tables and joins in memory on purpose (89 crew, 42 links, 23 intel
rows). At this size that is six round trips instead of four per axis. If it ever
reaches thousands of gigs the answer is a materialised view, not a cleverer query.

### Three things real data corrected

**Cities were joining two vocabularies and silently returning zero.** Venues
carry precise cities from Google (San Jose, Goleta, Bronx, Coppell); crew carry
how a person writes home on a roster ("Bay Area", "LA", "SLC", "Seattle/LV/NYC",
"Orlando? Florida?"). All 47 cities reported no local crew, which reads as an
empty roster rather than a failed join. Both sides now normalise through
`metroKeys()` (`geo.ts`). Downey finds 9, Bronx 6, Bellevue 4, Chandler 1.

`geo.ts` is a hand-kept list and that is a deliberate exception to lesson 73. The
distinction is what staleness costs: a recurring-client list is wrong the moment
a client books again, whereas metro geography does not move, and a MISS here
degrades to "no local crew" — visibly incomplete, never a person invented in the
wrong place.

**Client names were domain stems** — Collegeboard, Ebay, Fm, Getclario Ai, Str,
Oxw. The domain is the right *identity* (one company, one row, however the gig
was titled) and a terrible *label*. `orgDisplayName()` (`org-name.ts`) splits
them: the domain keys the row, the name comes from how Mason writes it in his own
gig titles, matched by concatenating 1–4 token windows from the title's first
segment. Six renamed themselves off his titles. Marketing prefixes are stripped
for the search only — getclario.ai is Clario.

**`/dev/*` was public in production.** `app.pixeltrunk.com/dev/buttons` answered
200 to anyone, unconditionally allowlisted in middleware since before this
feature. Now `NODE_ENV === "development"`, deliberately not `VERCEL_ENV !==
"production"` — that reads as the same rule and fails OPEN, because any
non-Vercel runtime satisfies it. Negative-tested against a real production build.

### Still open

- **Roles are 0 of 42 links.** The calendar records who was there and never what
  they did. The panel says so rather than hiding the section. Needs Mason, or a
  confirm card at upload time.
- **`crew_roles` is unseeded** — the vocabulary (photographer / digital tech /
  stylist / makeup artist / lead / assistant) exists only in conversation.
- **Three org names undecidable from the corpus**: episode1agency.com,
  typeaevents.com, wallandceiling.org. No gig title names them, so guessing at a
  client's name is exactly what `orgDisplayName` refuses to do.
- **Venue names are often street addresses** — correct behaviour (a leading house
  number means the calendar gave no venue name), but "2065 E Hamilton Ave" is a
  poor label for a room we have shot twice.

---

## 2026-08-14/15 — the editing pass, and what using it changed

Everything below came from Mason actually using the feature. Almost every item
is a correction, and the pattern is worth naming: **I shipped what verified at
the data layer, he found what was wrong at the UI layer.** Once I could drive
his logged-in Chrome (see SESSION-HANDOFF) that gap closed, but not before four
avoidable round trips.

### The model, as it settled

| | what it answers | shape |
|---|---|---|
| `crew.kind` | what someone DOES | photographer \| stylist \| makeup artist |
| `crew.is_regular` | do you reach for them | boolean, MARKED not derived |
| `event_crew.roles` | what they did on THIS gig | `lead` flag + one discipline |
| `event_crew.confirmed_roles` | which of those a human endorsed | subset of `roles` |

**`kind` was staff/local/client/other and that was two questions badly.** "Do I
employ them" and "what do they do" are different, and `is_regular` already
answered the first. `client` was a category error — clients are ORGANISATIONS.
No catch-all: "other" absorbs everyone nobody classified and the list stops
meaning anything.

**`lead` is a flag, the discipline is a choice.** The first build made all six
roles one free multi-select, which allowed stylist AND photographer — impossible
on a real gig. Enforced in the API, not just the UI.

**`digital tech` is gone.** It never named a person, only a shift: the pair
trade off across the day and both do both. Folded into photographer, with
`assistant`.

**Regulars are marked, never derived from an event count** — the backfill covers
23 of 45 galleries, so a count calls a regular new and a one-off prolific.

### Two bugs that were really one idea

**A guess must not read as a fact, and a guess must not behave like a decision.**

`roles_source` marked a whole ROW as inferred. Clicking any chip flipped the row
to manual, so every other guess on it silently became endorsed — clicking "lead"
on Joey blessed the machine's opinion that he was also the photographer.

Worse, a guessed role was "on", so the dashed chip DELETED itself on click.
Mason: *"clicking lead ONLY chooses photographer"* — because lead vanished while
photographer turned solid in the same frame.

`confirmed_roles` fixes both. Three states, and dashed means *not yet yours*:

    outline  not on the gig  → click adds it, confirmed
    dashed   still a guess   → click CONFIRMS it, and only it
    solid    yours           → click removes it

### Where things live now

- **`/intel`** — Crew · Venues · Cities · Clients · **Roster**. The first four
  are pivot axes over one fact table; Roster is where the list is EDITED
  (search, add, bulk archive, regulars filter, star).
- **Event page → Intel tab** — venue (editable, incl. naming one), crew with
  roles, client.
- **Event page → under the photos** — `EventCrewConfirm`, a TO-DO that renders
  only while something is unconfirmed and vanishes when answered.
- **`/api/crew`, `/api/venues`, `/api/organizations`** — full CRUD, archive over
  delete wherever `event_*` references the row, server-verified.

### Built 2026-08-15 — confirmation on the CREATE EVENT screen

The piece Mason asked for first, and the last one to land. *"I was assuming it
would be on the very first screen where you create the event. Where you enter
the name and date. And it pre-populates if you use the autocomplete."*

**The name field IS the autocomplete.** Type a client, a venue or a city; the
matching gigs appear with their dates, venue and crew count; picking one
pre-fills the name and date and opens a confirm card carrying venue, crew and
payer. Creating the event writes all of it, already confirmed.

| | |
|---|---|
| `src/lib/event-intel/match-gig.ts` | The scoring, now shared |
| `src/lib/event-intel/lookup-gigs.ts` | Windowed calendar fetch + 5-min cache |
| `src/lib/event-intel/apply-gig.ts` | The writer — venue, crew, payer, provenance |
| `src/lib/event-intel/roles.ts` | The role vocabulary and its shape rule |
| `GET /api/events/suggest-gig` | The lookup |
| `POST /api/events` | Optional `intel` body, written last and never fatal |
| `src/components/events/CreateGigConfirm.tsx` | Dropdown + confirm card |
| `/dev/gig-confirm` | Fixture playground |

**Picking the gig IS the confirmation.** `event_intel.confirmed_at` is set, so
the backfill will never revisit that event. Roles keep the three-state model:
the discipline implied by a person's `kind` arrives as a GUESS (tinted, italic)
and only a click makes it a decision.

**Four things that were only findable by running it:**

1. **`normaliseClient` stripped a LEADING "Set Up for X" but not a trailing "X
   Set Up".** Its own comment describes the bug it did not prevent. 15 set-up
   entries in one window were separate gigs; the Appfolio job appeared twice, a
   day apart, and the second copy carried the payer domain the first lacked.
2. **Everything copied INTO the event has to come from the JOB entry.**
   `groupIntoGigs` takes its client and start from whichever entry opened the
   group — the set-up. In production that named a gallery "Appfolio Set Up" and
   dated it to the load-in. `start`/`end` stay the true range; `client` and a
   new `shootDate` come from the first `kind === "gig"` entry.
3. **A typeahead is not the backfill's matcher.** "perk" is not a token overlap
   with "Perkin Elmer" and never will be. `scoreTypeahead` adds prefix coverage
   on top of the strict signals; the backfill keeps the strict ones alone,
   because a prefix rule there would match "Pure Storage" to "Purely Social" and
   attach the wrong crew to a gallery nobody re-checks.
4. **A row's badge changed its height.** "not a regular" beside the name pushed
   the role chips past the card width, so local hires wrapped to a ragged second
   line and regulars did not. The badge stacks under the name now.

**Two controls, two shapes** (Mason, 2026-08-15: *"you have the corner radii
swapped"*). `lead` is a squared-off chip — a flag. The discipline is a fully
rounded segmented track — a choice, where picking one necessarily un-picks the
others. Rendering both as identical pills made an illegal pair look legal.
Emerald for both active states; the harsh black is gone.

Still open: the create card cannot add someone who is NOT on the roster (the
event page's picker can). An unmatched attendee is reported as a count.

### Answered by Mason, so do not re-derive

- **All staff get a calendar invite.** So attendee-matching is sound, and a gig
  with no crew means the backfill did not match the ENTRY, not that people were
  missing from it.
- **`can_lead` is not needed.** Dropped from the UI; column kept.
- **"Photographer" needs no better name** — in this shop the digital-tech work
  IS part of being the photographer.

---

## 2026-08-15 (later) — rating, temps, and the region question

### The rehire ladder

`event_crew.would_rebook` now carries **`first_call | solid | last_resort |
never`** — Mason's own words, ordered best-to-worst. It replaced `yes|maybe|no`,
which collapsed "I'd call them first" and "they were fine" into one answer,
losing exactly the distinction he asked for: *"whether they were a solid hire or
a last resort."*

Free to change, and checked before choosing: **0 of 40 links carried a
judgement** and the column has no CHECK constraint (migration 056 leaves it plain
text with a comment). Legacy values map forward in `cleanRehire`, so an old row
never becomes meaningless.

Colours come from the SEVERITY ramp (stone / amber-700 / red-700), never emerald
— a rehire judgement about a named person is not the brand's accent.

### Three rules that came out of using it

**Rate at the moment of upload, not later.** Mason: *"this is actually the best
moment to get the feedback since the lead from the event is uploading just after
working with them."* The rating and note live on the create card, on non-regulars
only — your own team is not something you score gig to gig.

**A standing must not be visible while you are forming one.** *"Show ratings ...
on events AFTER they've been rated to eliminate bias."* Seeing "First call ×4"
while deciding today's rating is an invitation to agree with yourself, and an
independent judgement per gig is the whole value of the data.
`standingVisibleFor()` is the single expression of that gate.

**It is not an average.** Mason asked for one; a mean over an ordinal ladder
gives "2.3", which names no action, and it buries one disastrous gig under four
fine ones. `rehireStanding()` returns the MOST RECENT judgement as the headline
(people improve and decline), the full distribution for the hover, and
`hardNo` — true if a `never` exists anywhere, surfaced regardless of age.

**"Never again" sinks, it does not disappear.** *"Drop the 'do not hires' to the
end of our list so we can keep them in the system."* `compareCrewForPicker()` is
the one comparator every picker shares; a hard no sorts last even if they are
somehow marked a regular, because that combination is a contradiction someone
should see rather than have resolved for them. Archiving stays the separate,
deliberate act for people who are simply gone.

### Temps

The calendar knows who was **invited**, so anyone hired on the day is invisible
to it — and that is precisely the person whose rating matters, because there is
no other record of them. "+ Someone else worked this" adds a row inline. Nothing
is written until the event is created: a temp typed into an abandoned form should
not leave a person behind. They ride the same `crew[]` payload as everyone else
(`newPerson` instead of `crewId`), so no caller has to reconcile a parallel array.

### Ordering the autocomplete

Three keys: **unclaimed first, then score, then most recent first** (Mason,
2026-08-15). Recency is not a rare tiebreak here — the typeahead's scores are
coarse by design, so three Appfolio gigs all score 1.00 on a prefix, and among
equally good matches the one you just shot is the one you are here for. Before
this the tie fell through to the calendar's own ascending order, which put the
OLDEST first: exactly backwards. Score still outranks recency, so typing
"perkin" finds the 2018 gig.

### Already-mapped gigs are marked, never hidden

22 calendar entries already belong to a gallery. They now grey out, say which
gallery claims them, and sort last — but stay pickable. One gig legitimately
produces two galleries (a split delivery, a re-shoot), and a silently missing row
is indistinguishable from the calendar having lost it.

### Region filtering — the design, not yet built

Mason: *"maybe a more useful tool is to choose a location and then have a
slider/field for MILES FROM."* Agreed, and the nested-region taxonomy he floated
first should be dropped entirely.

- **Named regions fail at the boundary, which is where the answer usually is.**
  A job in Philadelphia wants NY, Baltimore, DC and Pittsburgh — "Northeast" plus
  "Mid-Atlantic" plus part of "Midwest" depending on whose map. A radius centred
  on the job needs no boundaries.
- **It makes international stop being a tier.** Amsterdam→Berlin is 400 miles;
  same mechanism, no parallel vocabulary for four events.
- **Label the bands by cost, not distance** (Mason likes this): drivable / short
  flight / long haul. 300 miles in the Northeast corridor is a train; 300 out of
  Salt Lake is a flight either way.
- **`Traveler` must be visible in results.** Measured: 16 of 61 active crew say
  yes, 10 say no, **35 are unset** — so a silent filter on that field would drop
  more than half the roster on missing data.

**The real cost, measured.** `metroKeys()` resolves 100% of crew and venue
locations — but by being *permissive*, returning several overlapping keys per
input so things match. It is a fine matching vocabulary and a poor coordinate
key: the resolved set includes `east coast`, `west coast`, `tx`, `eu`. A radius
needs ONE canonical home per person. Of 61 active crew most are unambiguous
("Nashville", "Santa Barbara"); a handful are not, and "Seattle/LV/NYC" is
someone working three markets who should carry SEVERAL bases, not one. So:
`crew.home_metros[]`, a short confirmation pass over ~15 people, and a hand-kept
lat/lng table of ~40 metros. No API, no per-lookup cost — the same trade `geo.ts`
already makes because geography does not move.

### The roster editor — seeding the list from the Crew panel

Built 2026-08-15. Editing lives in the panel you are already investigating,
because nobody looking at a person wants to go elsewhere to correct them.

**A regular is asked almost nothing.** Mason: "all regulars can lead and travel"
and "all regulars are photographers ... so they really don't need the role pill
either, just whether or not they led an event." **Verified before hiding any
control** — hiding one on a false premise silently mislabels people — and it
holds: 15 regulars, ALL `kind: photographer`; 46 non-regulars, all stylists
(`scripts/triage/regular-kinds.ts`). So a regular shows one control, the star,
and the rest is STATED as implied rather than left blank, since blank reads as
"not recorded" rather than "not a question".

`canLead()` and `willTravel()` in `roles.ts` are the one home for that
implication. This matters most for the radius search: **35 of 61 active crew
have `travels` unset**, so reading absence as "will not travel" would silently
drop half the roster.

**A person-level rehire baseline** (`crew.rehire`, migration 060) exists because
most of the roster has no gig to attach a real rating to — 89 crew against 40
links — and "seed the current list" is a standing opinion about a person, not a
judgement about a gig. `rehireStanding()` makes a real per-gig rating always
outrank it, and a seeded value renders italic and says so, so it never looks
earned.

**Stars are in the list**, not only the panel: scanning 61 people for your own
team is the common case, and a badge you must open something to see does not
help with that.

**Colour split.** Brand emerald marks a FACT about a person (discipline, can
lead, travels, regular). The rehire ladder keeps the severity ramp — "never
again" in the brand's green would be absurd, and severity is kept separate from
the accent everywhere in this app.

### Still not built

- **The SPS import flow (`/events/import`) has no crew card.** It mints events
  too, so it has the identical gap. It should share `CreateGigConfirm`, not grow
  its own.
- The radius filter above, and the `crew.home_metros[]` groundwork it needs.

---

## 2026-08-15, later — what the day settled

Everything below came from Mason using the feature on the Chicago import, in
his words where the wording carries the decision.

**Access is gated per account** (`src/lib/event-intel/access.ts`, lesson 85).
`EVENT_INTEL_USER_IDS` names the studio; `hasIntelAccess()` / `getIntelUser()`
are the only gates. Measured before choosing: every crew (86), venue (17), org
(12), event (44) and intel row (22) belongs to **info@twodudesphoto.com**,
while `is_admin` is mason@'s alone — so gating on admin would have inverted the
answer. Intel follows the EFFECTIVE user (data belongs to the archive you are
looking at); Ops follows the REAL one (a power act-as must not lend). Interim
by construction: when users connect their own calendars this becomes "do you
have a calendar connection", exactly as `sps_connections` already works.

**The radius search** — "Near [city]" + drivable / short flight / anywhere,
client-side over `geo.ts`. GROUPS, not a filter: within reach, further out,
can't-place. 33 distinct crew locations, only 3 unmappable ("EU", "Kentucky",
"Orlando? Florida?"), reported rather than dropped. Distances are STRAIGHT-LINE
and the page says so. No `crew.home_metros` column — 61 people is a roster
loaded whole, and a stored copy would go stale invisibly when a city is edited.

**`can_lead` and `travels` are gone.** "Let's drop these data points
everywhere. We don't need to track." `can_lead` duplicated the per-gig `lead`
role; `travels` duplicated the radius search and was unset on 35 of 61 people,
so it mostly sorted on ignorance. The "Would travel" group went with it.
Columns left dormant, unread and unwritten — dropping is irreversible.

**Last hired** (migration 062) — "Aug 2024 (2 yrs)", "(Recent)" inside a year,
non-regulars only. Stored value is the hand-entered SEED; the displayed value
is `max(seed, newest linked event)`, derived on read, which is what makes
"updates any time they work an event" true with no write to remember.
`scripts/backfill-last-hired.ts` seeded 77 of 87 from twelve years of calendar
(max-only; studio sittings and future dates excluded). Shows on the Crew list,
the Roster, the crew panel, the /people person card, and the confirm cards.

**Alumni** — archived crew are "Alumni" in every UI, `archived` in the data.
Bands (All · Regulars · Non-regulars · Alumni) appear on the Crew axis, the
Roster and the /people wall; they default to All and NARROW SEARCH. Mark and
restore work from the Crew panel as well as the Roster.

**Three fixes from the Chicago import**, worth knowing because each was a
class of bug rather than a typo:
- The event page's Intel panel still spoke `yes/maybe/no` — it shipped before
  the rehire ladder and was missed in the swap. It now speaks the ladder, and
  normalises legacy values for DISPLAY so an old "yes" lights "Solid".
- The confirm card reseeded every pick when a gig was re-picked, so "Not this
  one" → pick again silently wiped ratings (a wiped LEAD gets re-clicked; a
  wiped RATING is invisible). Keyed on `gig.key` now.
- A regular's discipline seeded as a GUESS, so every import ended with "N
  assignments are still a guess" about his own team. "All regulars are
  photographers" is settled, so it seeds confirmed.

**Still open:** alumni panels still offer the full working-crew controls
(discipline, rehire) — flagged to Mason, undecided. And the two dormant
columns await a migration if he wants them really gone.
