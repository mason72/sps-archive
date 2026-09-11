-- "These two shoots are the same person" — a human's word on a name the
-- /people wall split by faces (src/lib/people/face-split.ts).
--
-- Anchored to EVENTS, never to card keys. The first draft stored these as
-- person_aliases rows on the split cards' derived keys; review caught that
-- the alias table is the NAME resolver, so a card-key row could re-key a whole
-- name ("alex" → "alex~<event>"), and that derived keys move whenever photos
-- land or a face scan regroups — orphaning the merge. A pair of event ids
-- under a name key means the same thing on every rebuild.
--
-- Stored ordered (event_a < event_b) so one fact is one row.

create table if not exists person_split_links (
  user_id    uuid not null references auth.users(id) on delete cascade,
  name_key   text not null,
  event_a    uuid not null references events(id) on delete cascade,
  event_b    uuid not null references events(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, name_key, event_a, event_b),
  check (event_a < event_b)
);

-- Service role only: the routes that write it hold the service client and
-- check event ownership themselves.
alter table person_split_links enable row level security;

comment on table person_split_links is
  'Human-confirmed "same person" links between two events under one name the /people wall split by faces. Event-anchored so it survives card-key changes.';
