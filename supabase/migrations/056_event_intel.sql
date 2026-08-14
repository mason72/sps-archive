-- Event Intel — venues, crew, organisations and the links between them.
--
-- Back-office metadata on an event: where it happened, who worked it, who paid,
-- and what we want to remember. NEVER visible to a client. Design and reasoning:
-- tasks/event-intel.md.
--
-- ── Three shapes worth understanding before changing anything here ───────────
--
-- 1. IDENTITY IS AN EMAIL, NOT A NAME. Twelve years of calendars call the same
--    person Joey, Joseph and JOEY, and "Stretch" matches neither an email
--    local-part nor a legal name. `crew.primary_email` is the key and
--    `crew.aliases` holds the addresses that resolve to it — Joey has both
--    joey@twodudesphoto.com and joeynags@gmail.com on the SAME event, so
--    deduping by raw email would make him two people.
--
-- 2. ROLES ARE A SET PER PERSON PER EVENT, not a column. Photographers and
--    digital techs trade off during a gig, so one person genuinely holds both.
--    Several people may hold `lead` on one event when there is more than one
--    booth, so nothing here is unique on (event, role).
--
-- 3. "CLIENT" IS THREE COMPANIES. An event can be AT Autodesk University, FOR
--    Intel, and paid for by the agency that hired us. So there is no client_id
--    on the event: organisations get a registry and a ROLE, exactly as people
--    do. The payer is the client; the others are still worth keeping.
--
-- Everything is user-scoped. Not for multi-tenancy — for safety. `getAuthUser()`
-- hands back the SERVICE client, which bypasses RLS, and the ownership filter is
-- what stands between a query and someone else's data. That omission has shipped
-- as an IDOR here twice (lessons #2 and #14). A deliberately single-tenant table
-- with no user_id would be the next one.

-- ── Registries ──────────────────────────────────────────────────────────────

create table if not exists venues (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  -- Google Place id when we ever resolve one. Deliberately nullable: the
  -- calendar's `location` strings are already clean ("Grace Cathedral", "The
  -- Scottsdale Plaza Resort") and paying for Places before we know we need it
  -- would be cost without benefit.
  place_id    text,
  address     text,
  city        text,
  region      text,
  country     text,
  lat         double precision,
  lng         double precision,
  -- Permanent truths about the room: the loading dock, the power, the security
  -- lead time. Distinct from a note about one gig — merging the two turns the
  -- venue page into a chronological pile nobody reads.
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists venues_user_name_idx on venues (user_id, lower(name));
create index if not exists venues_user_city_idx on venues (user_id, lower(city));

create table if not exists crew (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- What the team calls them. "Stretch" is what Mason will search for, and it
  -- matches neither an email nor a legal name, so it is its own column.
  display_name   text not null,
  full_name      text,
  -- Prefer the @twodudesphoto.com address: staff migrated from personal email
  -- and the company one is current.
  primary_email  text,
  aliases        text[] not null default '{}',
  -- staff | local | client | other. Belongs to the PERSON, decided once after
  -- merging — never derived per record from the address, or Joey reads as a
  -- local hire in 2018 and staff in 2023.
  kind           text not null default 'other',
  city           text,
  region         text,
  -- From the roster spreadsheet: a standing capability, NOT the same thing as
  -- having led a particular gig.
  can_lead       text,           -- yes | maybe | no
  travels        boolean,
  archived       boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists crew_user_primary_email_idx
  on crew (user_id, lower(primary_email)) where primary_email is not null;
create index if not exists crew_user_display_idx on crew (user_id, lower(display_name));
-- Alias lookup is the hot path of the whole backfill: given an attendee email,
-- which person is this?
create index if not exists crew_aliases_idx on crew using gin (aliases);

create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  -- Email domain is the canonical key for an organisation, as email is for a
  -- person: opusagency.com → Opus Agency however the gig was titled.
  domains     text[] not null default '{}',
  kind        text not null default 'unknown',  -- agency | brand | venue_host | individual
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists organizations_user_name_idx on organizations (user_id, lower(name));
create index if not exists organizations_domains_idx on organizations using gin (domains);

-- Roles come from a list, never free text — the same rule as crew names, for the
-- same reason. Free text yields Photographer / photographer / Photog and the
-- pivot silently splits.
create table if not exists crew_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists crew_roles_user_name_idx on crew_roles (user_id, lower(name));

-- ── Per-event links ─────────────────────────────────────────────────────────

create table if not exists event_intel (
  event_id           uuid primary key references events(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  venue_id           uuid references venues(id) on delete set null,
  -- Which calendar entries this was derived from. An array because ONE gallery
  -- is often several entries — set-up, the day itself, an evening reception.
  calendar_event_ids text[] not null default '{}',
  source             text not null default 'manual',  -- calendar | manual
  -- Confirmed data WINS over any later calendar edit. Without this a re-sync
  -- silently overwrites a human correction, which is the fastest way to make
  -- someone stop trusting the suggestions.
  confirmed_at       timestamptz,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists event_intel_user_idx on event_intel (user_id);
create index if not exists event_intel_venue_idx on event_intel (venue_id);

create table if not exists event_crew (
  event_id      uuid not null references events(id) on delete cascade,
  crew_id       uuid not null references crew(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- A SET. One person can be photographer AND digital tech on one gig, and
  -- several people can hold `lead` when there is more than one booth.
  roles         text[] not null default '{}',
  -- Structured, with prose secondary: more filterable, and more defensible for
  -- what is ultimately a judgement about a named individual.
  would_rebook  text,            -- yes | no | maybe
  note          text,
  created_at    timestamptz not null default now(),
  primary key (event_id, crew_id)
);
create index if not exists event_crew_crew_idx on event_crew (crew_id);
create index if not exists event_crew_user_idx on event_crew (user_id);

create table if not exists event_orgs (
  event_id   uuid not null references events(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- payer is the client. end_brand is whose event it actually is. host is the
  -- named conference or venue brand. All three are real and only one is billed.
  role       text not null default 'payer',
  created_at timestamptz not null default now(),
  primary key (event_id, org_id, role)
);
create index if not exists event_orgs_org_idx on event_orgs (org_id);
create index if not exists event_orgs_user_idx on event_orgs (user_id);

create table if not exists venue_notes (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references venues(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null,
  -- Which gig taught us this, when we know.
  event_id   uuid references events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists venue_notes_venue_idx on venue_notes (venue_id, created_at desc);

-- ── RLS, matching the house pattern (see `sections`) ─────────────────────────

alter table venues        enable row level security;
alter table crew          enable row level security;
alter table organizations enable row level security;
alter table crew_roles    enable row level security;
alter table event_intel   enable row level security;
alter table event_crew    enable row level security;
alter table event_orgs    enable row level security;
alter table venue_notes   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['venues','crew','organizations','crew_roles',
                           'event_intel','event_crew','event_orgs','venue_notes']
  loop
    execute format($f$
      drop policy if exists "Service role manages %1$s" on %1$I;
      create policy "Service role manages %1$s" on %1$I
        for all using (auth.role() = 'service_role');
      drop policy if exists "Users manage own %1$s" on %1$I;
      create policy "Users manage own %1$s" on %1$I
        for all using (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;

comment on table crew is
  'Canonical people. Identity is primary_email + aliases, never a name — twelve years of calendars spell the same person three ways.';
comment on table event_orgs is
  'Organisations linked to an event BY ROLE. The payer is the client; end_brand and host are different companies and all three can be true at once.';
comment on column event_intel.confirmed_at is
  'Set when a human confirms. Confirmed data wins over any later calendar edit — never silently overwrite it.';
