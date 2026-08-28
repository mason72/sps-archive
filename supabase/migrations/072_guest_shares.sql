-- 072 — guest-minted share links: lineage + cascade deactivation.
--
-- A gallery visitor can mint a share of one person's photos (a `selection`
-- share) from the share they were given. The new row records where it came
-- from (`parent_share_id`) so that:
--
--   1. The owner's share list can label it "created by a guest" — the label
--      IS the lineage, no extra column.
--   2. Killing the parent kills every link guests spawned from it. Enforced
--      by TRIGGER rather than in the two API routes that flip `is_active`,
--      because a comment saying "remember to cascade" is not an invariant —
--      any future writer (a script, a new route) gets the rule for free.
--
-- Depth is capped at ONE by the minting route (a mint from a derived share
-- records the ROOT parent), so the trigger never needs to recurse: children
-- have no children. Gates (password_hash, PIN columns) are COPIED at mint and
-- then maintained by the existing write-through routes, which update every
-- active share of the event — derived rows are ordinary rows.

alter table public.shares
  add column if not exists parent_share_id uuid
    references public.shares(id) on delete cascade;

-- Only derived shares carry a parent; the owner list and the cascade both
-- look rows up by it.
create index if not exists shares_parent_share_id_idx
  on public.shares (parent_share_id)
  where parent_share_id is not null;

-- Deactivating a share deactivates its children, whoever does it and however.
create or replace function public.deactivate_child_shares()
returns trigger
language plpgsql
as $$
begin
  update public.shares
     set is_active = false
   where parent_share_id = new.id
     and is_active;
  return new;
end;
$$;

drop trigger if exists shares_cascade_deactivate on public.shares;
create trigger shares_cascade_deactivate
  after update of is_active on public.shares
  for each row
  when (old.is_active and not new.is_active)
  execute function public.deactivate_child_shares();
