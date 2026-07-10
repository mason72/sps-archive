-- 033_infra_hygiene.sql
-- Advisor-driven hardening pass (Supabase security + performance linters).
-- All statements are idempotent and safe on the live DB (tiny tables, 26MB).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Lock down SECURITY DEFINER functions callable by anon/authenticated.
--    handle_new_user* are auth.users triggers; resolve_share_by_slug and
--    set_stack_cover have ZERO app callers (the app uses table queries / the
--    upload+cover routes do the work directly). None should be reachable via
--    PostgREST /rpc, so revoke EXECUTE from the API roles. (postgres/service
--    keep it — triggers still fire; the service client can still call.)
-- Revoke from PUBLIC (the default grant) as well as the named API roles —
-- revoking anon/authenticated alone leaves the PUBLIC grant in place.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_new_user_subscription() from public, anon, authenticated;
revoke execute on function public.resolve_share_by_slug(text) from public, anon, authenticated;
revoke execute on function public.set_stack_cover(uuid, uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Pin search_path on every flagged function (prevents search_path
--    hijacking of SECURITY DEFINER fns; harmless hardening for the rest).
alter function public.handle_new_user() set search_path = public;
alter function public.handle_new_user_subscription() set search_path = public;
alter function public.resolve_share_by_slug(text) set search_path = public;
alter function public.set_stack_cover(uuid, uuid) set search_path = public;
alter function public.first_image_per_event(uuid[]) set search_path = public;
alter function public.search_images_by_embedding(vector, uuid, real, integer) set search_path = public;
alter function public.search_faces_by_embedding(vector, uuid, real, integer) set search_path = public;
alter function public.update_updated_at() set search_path = public;
alter function public.event_image_status_counts(uuid) set search_path = public;
alter function public.increment_share_views(uuid) set search_path = public;
alter function public.get_activity_totals(uuid) set search_path = public;
alter function public.record_auth_attempt(text, integer, integer) set search_path = public;
alter function public.get_daily_activity(uuid, integer) set search_path = public;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Covering indexes for foreign keys flagged as unindexed (avoids slow
--    FK-check scans + speeds the joins these columns feed).
create index if not exists idx_activity_log_image_id on public.activity_log (image_id);
create index if not exists idx_email_sends_template_id on public.email_sends (template_id);
create index if not exists idx_event_templates_user_id on public.event_templates (user_id);
create index if not exists idx_events_cover_image_id on public.events (cover_image_id);
create index if not exists idx_shares_person_id on public.shares (person_id);
create index if not exists idx_shares_section_id on public.shares (section_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Drop the exact-duplicate index on subscriptions (both index
--    stripe_customer_id; keep the more descriptively named one).
drop index if exists public.idx_subscriptions_customer;
