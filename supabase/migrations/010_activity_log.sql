-- Migration 010: Activity logging for analytics dashboard
-- Append-only event log for tracking gallery engagement

-- ── activity_log table ──
create table if not exists activity_log (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  event_id      uuid references events(id) on delete set null,
  share_id      uuid references shares(id) on delete set null,
  image_id      uuid references images(id) on delete set null,
  action        text not null,
  metadata      jsonb default '{}',
  created_at    timestamptz not null default now()
);

-- Actions:
--   share_view         — client opened a shared gallery
--   image_view         — client viewed an image in lightbox
--   image_download     — client downloaded a single image
--   image_favorite     — client favorited an image
--   image_unfavorite   — client unfavorited an image
--   gallery_download   — client downloaded full gallery zip
--   share_created      — photographer created a share link

comment on table activity_log is 'Append-only engagement log for analytics';

-- ── Indexes ──
create index idx_activity_user_created    on activity_log (user_id, created_at desc);
create index idx_activity_event_created   on activity_log (event_id, created_at desc);
create index idx_activity_action_created  on activity_log (action, created_at desc);
create index idx_activity_share           on activity_log (share_id) where share_id is not null;

-- ── RLS ──
alter table activity_log enable row level security;

-- Photographers see only their own activity
create policy "Users see own activity"
  on activity_log for select
  using (user_id = auth.uid());

-- Insert is handled by service role (server-side logging), so no insert policy
-- for authenticated users. The service client bypasses RLS.

-- ── Aggregate function: daily activity counts ──
-- Returns { date, action, count } rows for the given user + time range.
-- Efficient server-side aggregation avoids shipping raw rows to the client.
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
security definer
as $$
  select
    date_trunc('day', created_at)::date as day,
    action,
    count(*) as total
  from activity_log
  where user_id = p_user_id
    and created_at >= now() - (p_days || ' days')::interval
  group by day, action
  order by day asc, action asc;
$$;
