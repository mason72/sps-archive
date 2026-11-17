-- Stored Highlights taste directions (2026-11-16).
--
-- trainHighlightDirection reads ~6,000 photo embeddings from the owner's past
-- Highlights sets to average them into one 1,152-number direction: 10 s on
-- every propose from a cold server (Electronica 2026). The result depends only
-- on WHICH past sets exist and how many picks each holds, so it is stored under
-- a fingerprint of exactly that (plus the trainer's version), and retrained
-- only when a Highlights section somewhere changes. `vector` null means "no
-- direction" (too few real picks), which is also worth remembering.
--
-- Server-only: RLS on with no policies, and the API roles' grants revoked.

create table if not exists highlight_directions (
  signature text primary key,
  owner_user_id uuid not null,
  vector real[],
  trained_on_events integer not null default 0,
  trained_on_picks integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists highlight_directions_owner_idx on highlight_directions (owner_user_id);

alter table highlight_directions enable row level security;
-- service_role is in the revoke too: its default grant is all eight rights, and
-- granting four by name on top leaves all eight (platform-gotchas.md).
revoke all on table highlight_directions from public, anon, authenticated, service_role;
grant select, insert, update, delete on table highlight_directions to service_role;
