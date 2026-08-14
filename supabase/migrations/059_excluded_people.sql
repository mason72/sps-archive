-- Identities the photographer has said are NOT people.
--
-- The People index derives identity from filenames, and a filename is not a
-- promise. Real examples from the live archive:
--
--   "Jordan BackToSchool Banner.ai"   an Illustrator artboard, filed as a person
--   "Twodudes Arizona"                a filename PREFIX — 2018_02_12_twodudes_arizona-*
--                                     — which arrived with 439 photos of a 2018
--                                     conference and became the archive's most
--                                     photographed "person"
--
-- Both pass `looksLikePersonName`: two capitalised words, no digits. They are
-- indistinguishable from a name by inspection, which is exactly why this cannot
-- be solved with a better regex. Someone has to be able to say "not a person",
-- once, and have it stick.
--
-- KEYED ON THE NORMALISED KEY, not the display name. `normalizeNameKey` is what
-- collapses "Twodudes Arizona" / "TWODUDES ARIZONA" / "twodudes arizona" into
-- one identity, so excluding the key excludes every spelling — otherwise the
-- same non-person returns under the next capitalisation the corpus produces.
--
-- The name is stored alongside for the UI only. It is a label, never the key;
-- the same split as crew (email is identity, display_name is what you call
-- them) and organisations (domain is identity, name is what Mason writes).

create table if not exists excluded_people (
  user_id     uuid not null references auth.users(id) on delete cascade,
  person_key  text not null,
  -- What it was called when it was excluded. For showing an undo list; a
  -- rename must never resurrect the exclusion's subject.
  name        text,
  -- Free text: "Illustrator file", "filename prefix from the Perkin Elmer
  -- import". Worth having when someone wonders why a name vanished.
  reason      text,
  created_at  timestamptz not null default now(),
  primary key (user_id, person_key)
);

alter table excluded_people enable row level security;

drop policy if exists "Service role manages excluded_people" on excluded_people;
create policy "Service role manages excluded_people" on excluded_people
  for all using (auth.role() = 'service_role');

drop policy if exists "Users manage own excluded_people" on excluded_people;
create policy "Users manage own excluded_people" on excluded_people
  for all using (user_id = auth.uid());

comment on table excluded_people is
  'Identities the photographer marked as NOT people. Keyed on the normalised name key so every spelling of the same non-person is excluded at once. Filenames produce convincing fake names ("Twodudes Arizona", "Jordan BackToSchool Banner.ai") that no regex can separate from real ones.';
