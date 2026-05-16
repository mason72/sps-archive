-- Migration 014: Stripe event idempotency
--
-- Stripe retries webhook deliveries on any non-2xx response, and even on
-- 2xx if the connection times out. Without an event-id ledger, retried
-- events can replay state transitions (double increments, plan flips on
-- out-of-order delivery, etc.). This table is the dedupe key: every
-- webhook handler inserts the event.id at the start; the unique
-- constraint rejects duplicates.

create table if not exists stripe_events (
  event_id      text primary key,
  event_type    text not null,
  received_at   timestamptz not null default now()
);

alter table stripe_events enable row level security;

create policy "Service role manages stripe_events"
  on stripe_events for all
  using (auth.role() = 'service_role');
