-- 071 — faces per image, for one event.
--
-- "Group" as a SEARCH TERM is a structural fact, not a visual concept: a
-- group photo is a frame with two or more detected faces. The model scored
-- the bare word "group" weakly (top 0.115 on a headshot day) and its relative
-- cut dropped every two-person frame, so Smart section found 14 of 36 while
-- the filename pass found all 36 (2026-08-21). The detector already counted
-- faces on every frame; this just hands that count to the search routes.
--
-- Plain aggregate, event-scoped; callers pass the event they have already
-- authorised. Service-role only (no grant to anon/authenticated).
create or replace function public.count_faces_by_image(target_event_id uuid)
returns table (image_id uuid, face_count integer)
language sql
stable
as $$
  select i.id as image_id, count(f.id)::int as face_count
  from public.images i
  left join public.faces f on f.image_id = i.id
  where i.event_id = target_event_id
  group by i.id
$$;

revoke all on function public.count_faces_by_image(uuid) from public;
revoke all on function public.count_faces_by_image(uuid) from anon, authenticated;
