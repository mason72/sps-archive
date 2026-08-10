-- Ops-tunable knobs (Phase 3 of "Alpha access + ops.pixeltrunk.com").
-- A tiny key/value store so thresholds can change without a deploy.
-- Service-role only, like every ops surface.
create table ops_config (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table ops_config enable row level security;

-- Anomaly gate: a user is flagged when yesterday's metered cost exceeds
-- multiplier × max(their own trailing-7-day average, baselineDailyCost).
-- The baseline floor exists so onboarding testers (whose own average is
-- near zero) don't page on their first real day; seeded at $1/day until a
-- week of measured TDP usage suggests better (per Mason, 2026-08-10).
insert into ops_config (key, value)
values ('anomaly', '{"baselineDailyCost": 1.0, "multiplier": 2}');
