-- Archive cards were cropping through faces: the fallback thumbnail was the
-- earliest image, rendered object-cover with no anchor, so every headshot card
-- was decapitated (Mason, 2026-08-10).
--
-- Two changes, both here so the pick and the crop agree:
--   1. return the focal point, so the card can anchor its crop;
--   2. PREFER an image that has one. focal_x/y are face-derived (auto-focal
--      pipeline) or hand-pinned, so "has a focal" is the closest thing to
--      "has a subject" — an event's earliest frame is often a test shot.
--
-- Return type changes need a drop; the signature is unchanged so callers and
-- the search_path hardening from 033 are re-applied below.
drop function if exists first_image_per_event(uuid[]);

create function first_image_per_event(p_event_ids uuid[])
returns table (event_id uuid, r2_key text, focal_x real, focal_y real)
language sql
stable
as $$
  select distinct on (i.event_id) i.event_id, i.r2_key, i.focal_x, i.focal_y
  from images i
  where i.event_id = any(p_event_ids)
    and i.processing_status <> 'error'
  order by i.event_id, (i.focal_x is null), i.created_at asc
$$;

alter function public.first_image_per_event(uuid[]) set search_path = public;
