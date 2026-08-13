-- delivery_stage(events) — the delivery ladder as a PostgREST computed column.
--
-- The archive list needs to FILTER and SORT by status, and status is not a
-- column: it is derived per request from shares, email_sends and activity_log
-- (src/lib/events/status.ts). Deriving it in the client cannot work once the
-- list is paged — you can only filter the rows you already fetched, which is the
-- same class of bug as the client-side search that returned nothing for "2022".
--
-- A function taking the table's row type becomes a *computed column* in
-- PostgREST: it can be selected, filtered (`delivery_stage=eq.draft`) and
-- ordered by, exactly like a real column, with no materialisation and nothing to
-- keep in sync. That is the only approach here that stays correct under paging.
--
-- ⚠️ This DUPLICATES the ladder in status.ts, which is a real cost. It is
-- accepted because the alternative — shipping every event to the client to sort
-- them — does not scale past one page. The two must be changed together, and the
-- ordering below is deliberately the same top-to-bottom as the TypeScript:
--
--   draft      no live share                      — your move
--   published  live share, no evidence anyone has it — you owe someone a link
--   sent       emailed from Pixeltrunk, not opened   — waiting on them
--   opened     someone has been in
--   downloaded they took the files                   — done
--
-- "Live" means is_active AND not past expires_at — an expired share is not a
-- delivered gallery, and treating it as one would hide work that needs redoing.

create or replace function public.delivery_stage(e public.events)
returns text
language sql
stable
as $$
  select case
    when not exists (
      select 1 from public.shares s
      where s.event_id = e.id
        and s.is_active
        and (s.expires_at is null or s.expires_at > now())
    ) then 'draft'
    -- Downloaded outranks everything below it: taking the files is the end of
    -- the ladder regardless of how the link travelled.
    when exists (
      select 1 from public.activity_log a
      where a.event_id = e.id
        and a.action in ('gallery_download', 'image_download')
    ) then 'downloaded'
    -- A view outranks an email: it is proof of arrival however the link got
    -- there, which is how six of Mason's fifteen galleries were delivered.
    when exists (
      select 1 from public.shares s
      where s.event_id = e.id
        and s.is_active
        and (s.expires_at is null or s.expires_at > now())
        and coalesce(s.view_count, 0) > 0
    ) then 'opened'
    when exists (
      select 1 from public.email_sends m
      where m.event_id = e.id and m.status = 'sent'
    ) then 'sent'
    else 'published'
  end;
$$;

comment on function public.delivery_stage(public.events) is
  'Delivery ladder for an event, as a PostgREST computed column. Mirrors src/lib/events/status.ts — change both together.';

-- The subqueries this walks, so filtering the whole archive stays cheap.
create index if not exists shares_event_active_idx
  on public.shares (event_id) where is_active;
create index if not exists activity_log_event_action_idx
  on public.activity_log (event_id, action);
create index if not exists email_sends_event_status_idx
  on public.email_sends (event_id, status);

-- Sorting by delivery_stage alphabetically gives draft, downloaded, opened,
-- published, sent — not the ladder, and useful to nobody. This exposes the same
-- value as an ordinal so "sort by status" surfaces unfinished work first.
create or replace function public.delivery_rank(e public.events)
returns int
language sql
stable
as $$
  select coalesce(
    array_position(
      array['draft','published','sent','opened','downloaded'],
      public.delivery_stage(e)
    ),
    99
  );
$$;

comment on function public.delivery_rank(public.events) is
  'Ladder position of delivery_stage, for ORDER BY. Ascending = least finished first.';
