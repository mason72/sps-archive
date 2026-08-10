-- Public waitlist for the invitation-only alpha. Applications land here from
-- the marketing site; Mason reviews them on /ops and approving one whitelists
-- the address + sends the branded invite (the allowed_signups flow).
create table waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique check (email = lower(email)),
  work_url   text,                        -- optional "where can we see your work"
  status     text not null default 'pending',  -- pending | invited | dismissed
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index idx_waitlist_status_time on waitlist(status, created_at desc);

-- Service-role only (RLS on, no policies): the public POST /api/waitlist
-- writes through the service client with its own rate limit + honeypot.
alter table waitlist enable row level security;
