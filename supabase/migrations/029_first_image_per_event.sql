-- Dashboard N+1 fix. The events list did a per-event "earliest image" query
-- for cover fallback (up to 1 round-trip per event). This returns the earliest
-- non-errored image for a whole batch of events in one shot, via DISTINCT ON.
-- The composite index makes the (event_id, created_at) ordering an index scan.
create index if not exists idx_images_event_created
  on images (event_id, created_at);

create or replace function first_image_per_event(p_event_ids uuid[])
returns table (event_id uuid, r2_key text)
language sql
stable
as $$
  select distinct on (i.event_id) i.event_id, i.r2_key
  from images i
  where i.event_id = any(p_event_ids)
    and i.processing_status <> 'error'
  order by i.event_id, i.created_at asc
$$;
