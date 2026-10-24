-- 097: SECURITY DEFINER functions are not an API for the public key.
--
-- Supabase's advisor (anon_security_definer_function_executable) flagged four functions
-- on 2026-10-24. All four run with their owner's rights, and Supabase's default grant let
-- anon and authenticated call them at POST /rest/v1/rpc/<name>. Evidence, read before
-- this file was written (docs: ~/Projects/claude-shared/docs/supabase-security-definer-review-2026-10-24.md):
--
--   * log_crew_judgement()  is a TRIGGER function (crew, event_crew). Postgres checks
--     EXECUTE on a trigger function only at CREATE TRIGGER, never when it fires; proved
--     on this project in a rolled-back transaction the same day. Nothing calls it over RPC.
--   * match_person_cluster, match_person_cluster_to_crew, refresh_person_reference_centroids
--     are called only by the server (identity-suggestions.ts and scripts) through the
--     service client: seven days of API logs show every call with apikey=service_role
--     (1,119 / 250 / 10 calls). refresh_* DELETES and rebuilds a user's reference
--     centroids for any user id handed to it, so the public key could wipe them.
--
-- Revokes only. No function body changes, no table lock (a REVOKE on a function updates
-- one pg_proc row). service_role and the owner keep EXECUTE. The DO block checks its own
-- result and raises (rolling everything back) if a right survives or service_role loses one.

do $$
declare
  sigs constant text[] := array[
    'public.log_crew_judgement()',
    'public.match_person_cluster(uuid, integer)',
    'public.match_person_cluster_to_crew(uuid, integer)',
    'public.refresh_person_reference_centroids(uuid, uuid, text[])'
  ];
  sig text; fn regprocedure; who text; leak text := '';
begin
  foreach sig in array sigs loop
    fn := to_regprocedure(sig);
    if fn is null then raise exception 'migration 097: % does not exist here', sig; end if;
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
  foreach sig in array sigs loop
    fn := to_regprocedure(sig);
    foreach who in array array['anon', 'authenticated'] loop
      if has_function_privilege(who, fn, 'execute') then
        leak := leak || format('%s can still run %s; ', who, sig);
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'execute') then
      raise exception 'migration 097: service_role cannot run % after this. Nothing was changed.', sig;
    end if;
  end loop;
  if leak <> '' then
    raise exception 'migration 097: the revoke did not take (%). Nothing was changed.', rtrim(leak, '; ');
  end if;
end $$;

notify pgrst, 'reload schema';
