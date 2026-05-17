-- Migration 013: Subscriptions table
--
-- The Stripe webhook + account API have been writing to a `subscriptions`
-- table since Phase 7, but no migration ever created it — code worked
-- only when the table happened to exist in the dashboard (manual setup)
-- AND it ran without typed access (we cast through `as unknown as`).
-- This migration makes the schema explicit and enforces RLS so subscription
-- rows can't leak via the anon role.

create table if not exists subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users(id) on delete cascade,

  stripe_customer_id       text unique,
  stripe_subscription_id   text unique,

  plan                     text not null default 'free'
    check (plan in ('free', 'solo', 'pro', 'studio', 'enterprise')),
  status                   text not null default 'free'
    check (status in ('trialing', 'active', 'past_due', 'canceled', 'free')),
  billing_interval         text
    check (billing_interval in ('monthly', 'annual')),

  current_period_start     timestamptz,
  current_period_end       timestamptz,
  trial_end                timestamptz,
  cancel_at_period_end     boolean not null default false,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_subscriptions_customer
  on subscriptions(stripe_customer_id);

alter table subscriptions enable row level security;

-- Owner-only read; never any anon access. Service role manages writes
-- (Stripe webhook + checkout flow).
create policy "Users can read own subscription"
  on subscriptions for select
  using (auth.uid() = user_id);

create policy "Service role manages subscriptions"
  on subscriptions for all
  using (auth.role() = 'service_role');

-- Auto-create a free-tier subscription row on signup so we never have to
-- branch on null. Pairs with the existing user_profiles trigger.
create or replace function handle_new_user_subscription()
returns trigger as $$
begin
  insert into public.subscriptions (user_id, plan, status)
  values (NEW.id, 'free', 'free')
  on conflict (user_id) do nothing;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_subscription on auth.users;
create trigger on_auth_user_subscription
  after insert on auth.users
  for each row execute procedure handle_new_user_subscription();

-- Backfill rows for any users who signed up before this migration.
insert into subscriptions (user_id, plan, status)
select id, 'free', 'free'
from auth.users
on conflict (user_id) do nothing;
