-- One person key in SQL, the same as the one in TypeScript.
--
-- The /people identity key (`normalizeNameKey`, src/lib/people/index-people.ts)
-- now folds accents: "Córdova", "Cordova" and a Mac export's decomposed
-- "Co◌́rdova" are one person (src/lib/people/name-text.ts). The reference-face
-- refresh minted the same key in SQL with the old ASCII rule,
-- `regexp_replace(lower(name), '[^a-z]', '', 'g')`, which DELETES an accented
-- letter instead of folding it ("Armando Nájera" → "armandonjera"). Left alone
-- the two keys disagree for every accented name: an exclusion stored by the app
-- would stop blocking that name's reference faces, and suggestions would carry
-- a key the wall does not know.
--
-- So the key gets one SQL home that mirrors the TypeScript step for step:
--   NFKD → fold the letters NFKD leaves whole (both cases listed, so no
--   locale's lowercasing is involved) → lower → keep a–z.
-- The fold table must match UNDECOMPOSED_FOLDS in name-text.ts — a unit test
-- parses this file to check, and `npx tsx scripts/triage/name-key-parity.ts`
-- compares the two functions on live data. ⚠️ translate() pairs its two strings
-- by position and silently drops the extras, so a miscounted target string
-- mis-folds every letter after the slip; real names alone would never show it.
--
-- Measured 2026-09-11 before applying: the new key differs from the stored one
-- for ONE row (Armando Nájera's reference centroid); 0 pending or decided
-- suggestions, 0 exclusions, 0 aliases, 0 split links; and 0 differences from
-- the old rule across every ASCII-only cluster name and 200,000 ASCII
-- filenames — for plain names nothing moves.

create or replace function person_name_key(p text)
returns text
language sql
immutable
parallel safe
as $$
  select regexp_replace(
    lower(
      replace(replace(replace(replace(replace(replace(replace(replace(
        translate(normalize(p, NFKD), 'ØøŁłĐđÐðĦħŦŧŊŋıĸ', 'oollddddhhttnnik'),
        'ß', 'ss'), 'ẞ', 'ss'), 'Æ', 'ae'), 'æ', 'ae'),
        'Œ', 'oe'), 'œ', 'oe'), 'Þ', 'th'), 'þ', 'th')
    ),
    '[^a-z]', '', 'g')
$$;

comment on function person_name_key(text) is
  'The /people identity key — twin of normalizeNameKey() in src/lib/people/index-people.ts. Change both together; verify with scripts/triage/name-key-parity.ts.';

-- The LIVE body of refresh_person_reference_centroids, read from pg_proc on
-- 2026-09-11 (not from an older migration file — production has carried
-- hand-applied objects before), with only the two key expressions changed.
create or replace function public.refresh_person_reference_centroids(
  p_user_id uuid,
  p_event_id uuid default null::uuid,
  p_excluded_event_names text[] default '{}'::text[]
)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  inserted_count int;
begin
  delete from person_reference_centroids c
  where c.user_id = p_user_id
    and (p_event_id is null or c.person_id in (
      select id from persons where event_id = p_event_id
    ));

  insert into person_reference_centroids
    (person_id, user_id, name_key, name, face_count, centroid, updated_at)
  select p.id, p_user_id,
         person_name_key(p.name),
         p.name, count(f.id)::int, avg(f.embedding)::vector(512), now()
  from persons p
  join events e on e.id = p.event_id
  join faces f on f.person_id = p.id and f.embedding is not null
  where e.user_id = p_user_id
    and (p_event_id is null or p.event_id = p_event_id)
    and not (e.name = any(p_excluded_event_names))
    and p.name is not null
    and person_name_key(p.name) not in (
      select person_key from excluded_people where user_id = p_user_id
    )
  group by p.id, p.name
  having count(f.id) >= 2;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$function$;

-- Re-key what the old rule stored, so nothing waits for its event's next scan.
update person_reference_centroids
   set name_key = person_name_key(name)
 where name_key is distinct from person_name_key(name);

update person_identity_suggestions
   set suggested_key = person_name_key(suggested_name)
 where kind = 'guest'
   and suggested_key <> ''
   and suggested_key is distinct from person_name_key(suggested_name);
