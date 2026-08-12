-- Reconstruct the database objects that exist in PRODUCTION but in no migration.
--
-- Found 2026-08-12 by scripts/triage/schema-audit.ts, after `event_readiness`
-- turned up serving every dashboard load while existing in no file anywhere in
-- the repo. The audit found 16 such objects and 12 ledger entries applied with
-- no corresponding file — migrations 012–018 (2026-05-17) plus five later
-- ad-hoc changes. The repo could not have rebuilt this database.
--
-- These definitions are DUMPED FROM THE LIVE DATABASE (pg_get_functiondef,
-- pg_indexes.indexdef, pg_policies, information_schema.columns), not written
-- from memory of what 012–018 said. That is the honest thing this file can be:
-- a faithful description of what is running, not a reconstruction of lost
-- history. It is deliberately ONE file rather than fake 012_…–018_… files,
-- which would claim to be originals they are not.
--
-- Every statement is idempotent, so applying it to the live database is a
-- no-op that proves the file matches reality, and applying it to an empty one
-- produces the objects. It must run AFTER the tables it references exist
-- (auth.users, images, sections), which 001–047 create.

begin;

set local lock_timeout = '8s';

-- ─── Tables (ledger: 013_subscriptions, 014_stripe_events) ──────────────────

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'free',
  status text not null default 'trialing',
  billing_interval text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Stripe webhook idempotency: the event id is the primary key, so a redelivery
-- collides instead of double-processing.
create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default now()
);

-- ─── Columns (ledger: 015_processing_state) ────────────────────────────────
-- Object names are not the schema: an unversioned ALTER leaves every table and
-- index check happy while the rebuilt table is the wrong SHAPE. A column-level
-- pass over all 269 live columns found exactly one whose name appears in no
-- migration. It survives only in the generated database.types.ts, which is
-- generated FROM the database and so could never have flagged it.

alter table public.images add column if not exists last_error text;

-- ─── Indexes (ledger: 017_photographer_star, and two never recorded) ────────

create index if not exists idx_images_event_starred
  on public.images using btree (event_id) where (starred = true);

create index if not exists idx_subscriptions_stripe_customer
  on public.subscriptions using btree (stripe_customer_id);

-- Case-insensitive section names, per event. Note 033 drops a DIFFERENT index
-- (idx_subscriptions_customer) as an exact duplicate of the one above — that
-- drop is the only mention of `subscriptions` anywhere in the repo's SQL, which
-- is how the missing table hid from a name-only audit.
create unique index if not exists sections_event_name_lower_unique
  on public.sections using btree (event_id, lower(name)) where (name is not null);

-- ─── Functions (ledger: 016_set_stack_cover, 018_section_atomicity, …) ──────

create or replace function public.event_image_status_counts(p_event_id uuid)
returns table(total bigint, pending bigint, processing bigint, complete bigint, failed bigint)
language sql stable set search_path to 'public'
as $function$
  select
    count(*) as total,
    count(*) filter (where processing_status = 'pending')    as pending,
    count(*) filter (where processing_status = 'processing') as processing,
    count(*) filter (where processing_status = 'complete')   as complete,
    count(*) filter (where processing_status = 'failed')     as failed
  from images
  where event_id = p_event_id;
$function$;

create or replace function public.handle_new_user_subscription()
returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  insert into public.subscriptions (user_id, plan, status)
  values (NEW.id, 'free', 'free')
  on conflict (user_id) do nothing;
  return NEW;
end;
$function$;

create or replace function public.resolve_share_by_slug(p_slug text)
returns table(
  id uuid, event_id uuid, share_type text, is_active boolean,
  allow_download boolean, allow_favorites boolean, require_pin_bulk boolean,
  require_pin_individual boolean, has_password boolean,
  expires_at timestamp with time zone, custom_message text,
  image_ids uuid[], section_id uuid, person_id uuid
)
language sql stable security definer set search_path to 'public'
as $function$
  select
    s.id, s.event_id, s.share_type, s.is_active, s.allow_download,
    s.allow_favorites, s.require_pin_bulk, s.require_pin_individual,
    (s.password_hash is not null) as has_password,
    s.expires_at, s.custom_message, s.image_ids, s.section_id, s.person_id
  from shares s
  where s.slug = p_slug and s.is_active = true
  limit 1;
$function$;

-- Promote a frame to its stack's cover, keeping stack_rank consistent.
create or replace function public.set_stack_cover(p_stack_id uuid, p_image_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_old_rank int;
  v_current_cover_id uuid;
begin
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

  if v_current_cover_id is not null and v_current_cover_id = p_image_id then
    update stacks set cover_image_id = p_image_id where id = p_stack_id;
    return;
  end if;

  update images set stack_rank = 0 where id = p_image_id;

  if v_current_cover_id is not null then
    update images set stack_rank = v_old_rank where id = v_current_cover_id;
  end if;

  update images set stack_rank = 1 where id = p_image_id;
  update stacks set cover_image_id = p_image_id where id = p_stack_id;
end;
$function$;

-- Section ordering, done in ONE statement so two concurrent reorders cannot
-- interleave into a half-applied order (ledger: 018_section_atomicity).
create or replace function public.create_section_at_top(
  p_event_id uuid, p_name text, p_description text default null
)
returns sections language plpgsql set search_path to 'public'
as $function$
declare
  new_row sections;
begin
  update sections set sort_order = sort_order + 1 where event_id = p_event_id;

  insert into sections (event_id, name, description, is_auto, sort_order)
  values (p_event_id, p_name, p_description, false, 0)
  returning * into new_row;

  return new_row;
end;
$function$;

create or replace function public.reorder_sections(p_event_id uuid, p_section_ids uuid[])
returns void language plpgsql set search_path to 'public'
as $function$
begin
  update sections s
  set sort_order = ord.position - 1
  from unnest(p_section_ids) with ordinality as ord(section_id, position)
  where s.id = ord.section_id and s.event_id = p_event_id;
end;
$function$;

-- ─── RLS policies (ledger: 012_share_security, 013_subscriptions) ───────────
-- Postgres has no CREATE POLICY IF NOT EXISTS, so each is dropped and recreated.
-- Inside this transaction that is atomic: no session ever observes the gap.

alter table public.subscriptions enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists "Service role manages shares" on public.shares;
create policy "Service role manages shares" on public.shares
  for all using (auth.role() = 'service_role');

drop policy if exists "Service role manages favorites" on public.favorites;
create policy "Service role manages favorites" on public.favorites
  for all using (auth.role() = 'service_role');

drop policy if exists "Service role manages subscriptions" on public.subscriptions;
create policy "Service role manages subscriptions" on public.subscriptions
  for all using (auth.role() = 'service_role');

drop policy if exists "Users can read own subscription" on public.subscriptions;
create policy "Users can read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "Service role manages stripe_events" on public.stripe_events;
create policy "Service role manages stripe_events" on public.stripe_events
  for all using (auth.role() = 'service_role');

-- ─── Trigger on auth.users ─────────────────────────────────────────────────
-- Production carries TWO triggers firing this same function on every signup:
-- on_auth_user_created_subscription and on_auth_user_subscription. Harmless
-- (the insert is `on conflict do nothing`) but redundant. Only ONE is recreated
-- here; dropping the live duplicate is a separate, deliberate change rather
-- than a side effect of writing history down.

drop trigger if exists on_auth_user_created_subscription on auth.users;
create trigger on_auth_user_created_subscription
  after insert on auth.users
  for each row execute function public.handle_new_user_subscription();

commit;
