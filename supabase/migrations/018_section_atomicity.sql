-- Migration 018: atomic section operations + duplicate-name guard
--
-- The section flow was historically the most painful surface — the
-- owner specifically flagged it. Two real bugs:
--
-- 1. Reorder and create both ran their UPDATEs as Promise.all of N
--    individual round-trips with no transaction. Any partial failure
--    (network, RLS, conflicting writes from a concurrent edit) left
--    sort_orders incoherent, which the user perceived as "I reordered
--    sections and they came back wrong."
--
-- 2. Nothing prevented duplicate section names within an event, so
--    photographers could create two "Portraits" sections and then play
--    whack-a-mole figuring out which one held which photos.
--
-- This migration adds:
--   - A case-insensitive unique constraint on (event_id, lower(name))
--   - reorder_sections(): one statement using FROM unnest()
--   - create_section_at_top(): bumps all sort_orders + inserts the new
--     row in a single transaction.

-- ── Duplicate-name guard (case-insensitive) ──────────────────────────
-- Skip rows with NULL name (shouldn't happen but the schema doesn't
-- enforce NOT NULL on name; we don't want the migration to fail on
-- pre-existing data).
create unique index if not exists sections_event_name_lower_unique
  on sections (event_id, lower(name))
  where name is not null;

-- ── Atomic reorder ───────────────────────────────────────────────────
-- Updates all sort_order values in one statement using the array's
-- position as the new sort_order. Scoped to the supplied event_id so
-- the RPC is harmless if a caller leaks unrelated ids.
create or replace function reorder_sections(
  p_event_id    uuid,
  p_section_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update sections s
  set sort_order = ord.position - 1
  from unnest(p_section_ids) with ordinality as ord(section_id, position)
  where s.id = ord.section_id
    and s.event_id = p_event_id;
end;
$$;

grant execute on function reorder_sections(uuid, uuid[]) to authenticated, service_role;

-- ── Atomic create-at-top ─────────────────────────────────────────────
-- Bump every existing section's sort_order by 1 and insert the new one
-- at sort_order 0 — both in one statement. Returns the new row.
create or replace function create_section_at_top(
  p_event_id     uuid,
  p_name         text,
  p_description  text default null
)
returns sections
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_row sections;
begin
  update sections
  set sort_order = sort_order + 1
  where event_id = p_event_id;

  insert into sections (event_id, name, description, is_auto, sort_order)
  values (p_event_id, p_name, p_description, false, 0)
  returning * into new_row;

  return new_row;
end;
$$;

grant execute on function create_section_at_top(uuid, text, text) to authenticated, service_role;
