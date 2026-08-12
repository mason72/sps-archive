-- Only the server calls these functions, so only the server should be able to.
--
-- Raised while writing 047: `event_readiness` carried EXECUTE for PUBLIC and
-- `anon`, meaning an unauthenticated caller holding the public anon key could
-- invoke it. Not a leak on its own — it takes exact gallery ids and returns
-- counts — but it is access nobody needs, and 047 deliberately recreated the
-- grants as-found rather than narrowing them inside a performance fix, where a
-- rollback would then have been ambiguous. This is that change, on purpose.
--
-- Verified before writing: EVERY `.rpc()` call site in the codebase is
-- server-side (src/app/api/** routes and src/lib/** modules) and runs on the
-- SERVICE client — including `record_auth_attempt`, which fires during login
-- before a session exists and takes a `createServiceClient` parameter. The
-- browser's Supabase client is used for auth plus ONE table read (the command
-- palette's events list, governed by RLS); it calls no functions at all.
--
-- The two signup TRIGGER functions are deliberately left alone. They fire on
-- auth.users insert as SECURITY DEFINER, the exact privilege semantics of a
-- trigger function at fire time are subtler than the rest of this file, and
-- signup is the alpha's front door. Zero gain, non-zero risk.

begin;

set local lock_timeout = '8s';

do $$
declare
  fn record;
  -- Anything reachable ONLY from the server. handle_new_user and
  -- handle_new_user_subscription are excluded on purpose (see header).
  keep_open text[] := array['handle_new_user', 'handle_new_user_subscription'];
begin
  for fn in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (
        select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e'
      )
      and not (p.proname = any(keep_open))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
    execute format('grant execute on function %s to service_role', fn.sig);
  end loop;
end
$$;

commit;
