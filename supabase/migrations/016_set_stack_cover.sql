-- Migration 016: atomic stack cover swap
--
-- /api/stacks/[stackId]/cover previously read the current rank-1 image,
-- then wrote the new cover, then wrote the old cover's rank in three
-- separate round-trips. Two concurrent "set as cover" requests on the
-- same stack could both observe the same starting state and both flip
-- their own pick to rank 1 — leaving the stack with two rank-1 images
-- and a flapping cover.
--
-- The SECURITY DEFINER function below does the swap in one SQL
-- transaction, scoped to images that actually belong to the stack
-- (and to the event the caller owns — checked via RLS on the calling
-- side; the function itself trusts that the route has authorized).

create or replace function set_stack_cover(p_stack_id uuid, p_image_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_rank int;
  v_current_cover_id uuid;
begin
  -- Read state inside the transaction.
  select stack_rank into v_old_rank
  from images
  where id = p_image_id and stack_id = p_stack_id;

  if v_old_rank is null then
    raise exception 'image % is not in stack %', p_image_id, p_stack_id
      using errcode = 'no_data_found';
  end if;

  select id into v_current_cover_id
  from images
  where stack_id = p_stack_id and stack_rank = 1
  limit 1;

  -- If the new cover already IS the cover, just touch the stack pointer.
  if v_current_cover_id is not null and v_current_cover_id = p_image_id then
    update stacks set cover_image_id = p_image_id where id = p_stack_id;
    return;
  end if;

  -- Swap. Use a temporary rank (0) to avoid two images with rank=1 even
  -- briefly mid-transaction; downstream code orders by stack_rank ASC
  -- with 1 as best, so an interim 0 still resolves consistently if a
  -- read leaks in.
  update images set stack_rank = 0 where id = p_image_id;

  if v_current_cover_id is not null then
    update images set stack_rank = v_old_rank where id = v_current_cover_id;
  end if;

  update images set stack_rank = 1 where id = p_image_id;
  update stacks set cover_image_id = p_image_id where id = p_stack_id;
end;
$$;

grant execute on function set_stack_cover(uuid, uuid) to authenticated, service_role;
