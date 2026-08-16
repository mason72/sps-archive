-- 064: two filename spellings, one human — the /people identity merge.
--
-- Identity on /people is the normalized filename name ("samihadouaj"), so
-- "Sami Hadouaj" and "Sami Hadouaj Mundra" are two tiles for one person, and
-- nothing in the corpus can prove they're the same — only a human can. This
-- table records that judgement: alias_key FOLDS INTO canonical_key everywhere
-- identities are computed.
--
-- Shape follows excluded_people (059): keyed on the normalized key so every
-- spelling of the alias folds at once; display names stored alongside for the
-- UI (labels, never keys) and for the detail query's candidate filter, which
-- needs a real spelling to ilike against.
--
-- Deliberately HUMAN-INITIATED only. Nothing writes here automatically — a
-- merge is a statement about who someone is, and the archive-wide caveat is
-- real: two different John Smiths are already ONE tile under filename
-- identity, and no automatic signal can safely say "same" or "different".
-- (The inverse — splitting a shared name by face — becomes possible once
-- identity is face-anchored; see tasks/people-group-shots.md.)
--
-- Chains are flattened at WRITE time (merging B into C rewrites rows whose
-- canonical was B), and the resolver follows chains defensively anyway.

create table if not exists person_aliases (
  user_id        uuid not null references auth.users(id) on delete cascade,
  alias_key      text not null,
  canonical_key  text not null,
  -- Display spellings, as the human saw them at merge time.
  alias_name     text not null,
  canonical_name text not null,
  created_at     timestamptz not null default now(),
  primary key (user_id, alias_key),
  -- A key cannot fold into itself; the API also refuses cycles.
  constraint person_aliases_not_self check (alias_key <> canonical_key)
);

alter table person_aliases enable row level security;

drop policy if exists "Service role manages person_aliases" on person_aliases;
create policy "Service role manages person_aliases" on person_aliases
  for all using (auth.role() = 'service_role');

drop policy if exists "Users manage own person_aliases" on person_aliases;
create policy "Users manage own person_aliases" on person_aliases
  for all using (user_id = auth.uid());

comment on table person_aliases is
  'Human-confirmed identity merges for /people: alias_key folds into canonical_key wherever filename identity is computed. Keyed on normalized keys so every spelling folds at once. Display names stored for the UI and the detail candidate filter. Human-initiated only — no automatic writes.';
