-- Intel notes & behind-the-scenes photos (2026-08-21).
--
-- Mason: "ability to attach BTS shots of a gig as part of the staff/intel
-- sheet ... map back to the venue so that we could look at a venue and see all
-- of the BTS shots ... notes/BTS should actually be for Client and/or Venue."
--
-- ONE table, and the unit is an ENTRY: some text, or a photo with a caption,
-- or both — never neither (the CHECK below is the rule, not the UI). Each entry
-- says who it is ABOUT: the venue ("don't use these stairs, there's an elevator
-- to the right"), the client ("their AV lead hates flash"), or both. The venue
-- page and the client page are DERIVED from those tags — there is no second
-- copy to keep in sync and no separate "venue photo" table.
--
-- Two deliberate absences:
--
-- NOT rows in `images`. Everything in `images` is a client deliverable: it is
-- what shares scope, what search indexes, what the ZIP exporter walks, what the
-- cover composer samples and what the People index reads. A crew photo of a
-- loading dock in that table is one missed exclusion away from a client seeing
-- it. Keeping BTS out of `images` entirely is what makes that impossible, the
-- same reasoning that keeps crew names out of `persons.name`. The objects live
-- under their own R2 prefix (`intel-notes/…`) for the same reason, outside
-- `events/…` where every gallery sweep looks.
--
-- NOT `venue_notes` (056). That table was modelled for this and never wired to
-- anything — zero rows, zero readers — and it could only describe a venue.
-- Dropped here rather than extended, so there is one home.

create table if not exists intel_notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  -- Which gig taught us this, when we know. Nullable: a site visit or a
  -- photo remembered a year later has no gig.
  event_id     uuid references events(id) on delete set null,

  -- RESOLVED FROM THE EVENT at write time when one is given (one fact, copied
  -- once, so the venue page is a plain indexed read and a bulk upload with no
  -- gig still lands somewhere). The event-intel PATCH that re-links a venue
  -- re-points that event's entries, which is the only way the copy can drift.
  venue_id     uuid references venues(id) on delete set null,
  org_id       uuid references organizations(id) on delete set null,

  -- Who the entry is ABOUT. Default both: the fast path is zero extra taps.
  about_venue  boolean not null default true,
  about_client boolean not null default true,

  body         text,
  -- The 2048px rendition and its 480px thumb, both made on the client.
  storage_key  text,
  thumb_key    text,
  width        integer,
  height       integer,
  -- From EXIF, when the photo carries it. The date the shot was TAKEN, which
  -- is not the date it was uploaded — a year later, from a camera roll.
  taken_at     timestamptz,

  -- Evergreen facts float above last year's chatter.
  pinned       boolean not null default false,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- Text or a photo; never neither.
  constraint intel_notes_has_content check (body is not null or storage_key is not null),
  -- It must land somewhere.
  constraint intel_notes_has_subject check (
    event_id is not null or venue_id is not null or org_id is not null
  )
);

create index if not exists intel_notes_user_idx  on intel_notes (user_id);
create index if not exists intel_notes_event_idx on intel_notes (event_id) where event_id is not null;
create index if not exists intel_notes_venue_idx on intel_notes (venue_id, pinned desc, created_at desc) where venue_id is not null;
create index if not exists intel_notes_org_idx   on intel_notes (org_id, pinned desc, created_at desc) where org_id is not null;

alter table intel_notes enable row level security;
drop policy if exists "Service role manages intel_notes" on intel_notes;
drop policy if exists "Users manage own intel_notes" on intel_notes;
create policy "Service role manages intel_notes" on intel_notes
  for all using (auth.role() = 'service_role');
create policy "Users manage own intel_notes" on intel_notes
  for all using (user_id = auth.uid());

comment on table intel_notes is
  'Internal notes and behind-the-scenes photos about venues and clients, tagged per entry. Never a guest surface, never rows in images.';
comment on column intel_notes.about_venue is 'This entry is about the room (shows on the venue page).';
comment on column intel_notes.about_client is 'This entry is about the client (shows on the client page).';
comment on column intel_notes.venue_id is 'Resolved from the event at write time when an event is given — the event-intel PATCH re-points it if the venue changes.';

-- A venue created from a Google Places pick carries its place id, and the same
-- building must never become two rows because two people typed two spellings.
create unique index if not exists venues_user_place_idx
  on venues (user_id, place_id) where place_id is not null;

-- Modelled in 056 for exactly this, never wired, never written. One home now.
drop table if exists venue_notes;
