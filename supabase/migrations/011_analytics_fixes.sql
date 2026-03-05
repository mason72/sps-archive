-- Migration 011: Analytics security & performance fixes
--
-- Fixes:
--   C1 — get_daily_activity: SQL injection via string concat, security definer
--   C2 — view_count race condition: add atomic increment function
--   I2 — 4 separate count queries: add consolidated totals function
--   I4 — Missing composite index for (user_id, action)

-- ── C1: Fix get_daily_activity — use make_interval + security invoker ──
create or replace function get_daily_activity(
  p_user_id   uuid,
  p_days      int default 30
)
returns table (
  day         date,
  action      text,
  total       bigint
)
language sql
stable
security invoker
as $$
  select
    date_trunc('day', created_at)::date as day,
    action,
    count(*) as total
  from activity_log
  where user_id = p_user_id
    and created_at >= now() - make_interval(days => greatest(p_days, 1))
  group by day, action
  order by day asc, action asc;
$$;

-- ── C2: Atomic view count increment (no read-then-write race) ──
create or replace function increment_share_views(p_share_id uuid)
returns void
language sql
security invoker
as $$
  update shares
  set view_count = coalesce(view_count, 0) + 1
  where id = p_share_id;
$$;

-- ── I2: Consolidated all-time totals (replaces 4 count queries → 1 scan) ──
create or replace function get_activity_totals(p_user_id uuid)
returns json
language sql
stable
security invoker
as $$
  select json_build_object(
    'views',     count(*) filter (where action = 'share_view'),
    'downloads', count(*) filter (where action in ('image_download', 'gallery_download')),
    'favorites', count(*) filter (where action = 'image_favorite'),
    'shares',    count(*) filter (where action = 'share_created')
  )
  from activity_log
  where user_id = p_user_id;
$$;

-- ── I4: Composite index for all-time count queries ──
create index if not exists idx_activity_user_action
  on activity_log (user_id, action);
