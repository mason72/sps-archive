-- Cached archive stats row (2026-11-24).
--
-- /api/stats counted every photo, share and favorite on each archive load:
-- for the 1,473-gallery account that is 31 PostgREST requests (15 image-count
-- chunks, 16 favorite-count chunks) and ~2.5 s on a quiet database, and it was
-- the first thing to fail (a bare HTTP 500 from one chunk) when the database
-- was busy. The four numbers change slowly, so they are computed at most once
-- per few minutes per account and served from here (src/lib/dashboard/stats.ts).
--
-- `computed_at` is when the computation STARTED, and store_dashboard_stats only
-- replaces an older start: two recomputes that overlap can finish in either
-- order, and the slower, older one must not overwrite the newer numbers.
--
-- Every stamp comes from THIS database's clock (dashboard_stats_clock, and
-- invalidate_dashboard_stats stamping itself), never from a server's: two
-- Vercel instances' clocks can differ by milliseconds, which is enough for a
-- recount that read the archive before a delete to out-rank the delete's
-- invalidation and serve the deleted gallery as fresh.
--
-- Server-only: RLS on with no policies, and the API roles' grants revoked.

create table if not exists dashboard_stats_cache (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stats jsonb not null,
  computed_at timestamptz not null
);

alter table dashboard_stats_cache enable row level security;
-- service_role is in the revoke too: its default grant is all eight rights, and
-- granting four by name on top leaves all eight (platform-gotchas.md).
revoke all on table dashboard_stats_cache from public, anon, authenticated, service_role;
grant select, insert, update, delete on table dashboard_stats_cache to service_role;

create or replace function store_dashboard_stats(p_user_id uuid, p_stats jsonb, p_computed_at timestamptz)
returns boolean
language sql
set search_path = public
as $$
  with written as (
    insert into dashboard_stats_cache as c (user_id, stats, computed_at)
    values (p_user_id, p_stats, p_computed_at)
    on conflict (user_id) do update
      set stats = excluded.stats, computed_at = excluded.computed_at
      where c.computed_at < excluded.computed_at
    returning 1
  )
  select exists (select 1 from written)
$$;

revoke all on function store_dashboard_stats(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function store_dashboard_stats(uuid, jsonb, timestamptz) to service_role;

-- A recount's start stamp, taken before it reads anything.
create or replace function dashboard_stats_clock()
returns timestamptz
language sql
volatile
set search_path = public
as $$
  select clock_timestamp()
$$;

revoke all on function dashboard_stats_clock() from public, anon, authenticated;
grant execute on function dashboard_stats_clock() to service_role;

-- Marks an account's stats as needing a recount (an empty row, which no read
-- accepts), stamped after the write that called it has committed, so any
-- recount that started earlier is refused by store_dashboard_stats.
create or replace function invalidate_dashboard_stats(p_user_id uuid)
returns void
language sql
set search_path = public
as $$
  select store_dashboard_stats(p_user_id, '{}'::jsonb, clock_timestamp())
$$;

revoke all on function invalidate_dashboard_stats(uuid) from public, anon, authenticated;
grant execute on function invalidate_dashboard_stats(uuid) to service_role;
