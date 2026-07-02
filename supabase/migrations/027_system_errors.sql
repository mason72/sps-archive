-- Silent-failure alarm rail. The guest-favorites bug ran at a 100% failure
-- rate for months because errors only went to console.error behind an
-- optimistic UI. reportSystemError() writes here from critical catch blocks
-- and emails the admin (ADMIN_ALERT_EMAIL) at most once per context per hour.
create table system_errors (
  id          uuid primary key default gen_random_uuid(),
  context     text not null,           -- e.g. "favorites.post", "emails.send"
  message     text not null,
  detail      jsonb,
  notified    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_system_errors_context_time
  on system_errors(context, created_at desc);

-- Service-role only (RLS on, no policies).
alter table system_errors enable row level security;
