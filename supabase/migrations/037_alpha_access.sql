-- Alpha access: admin flag + DB-backed signup allowlist.
-- Replaces the ALLOWED_SIGNUP_EMAILS env var so adding a tester never needs a
-- redeploy. Public Supabase signups are disabled at the project level
-- (2026-08-10) — /api/auth/signup's admin.createUser is the only door, and
-- this table is its lock.

alter table user_profiles
  add column is_admin boolean not null default false;

create table allowed_signups (
  email       text primary key check (email = lower(email)),
  invited_by  uuid references auth.users(id) on delete set null,
  invited_at  timestamptz not null default now(),
  joined_at   timestamptz,            -- set by the signup route on success
  note        text
);

-- Service-role only (RLS on, no policies) — read/written exclusively by
-- /api/auth/signup and the /ops invite panel via the service client.
alter table allowed_signups enable row level security;

-- Seed: the existing account is the admin and counts as already joined.
update user_profiles p set is_admin = true
from auth.users u
where p.user_id = u.id and u.email = 'info@twodudesphoto.com';

insert into allowed_signups (email, invited_by, joined_at, note)
select u.email, u.id, u.created_at, 'seed: founding account'
from auth.users u where u.email = 'info@twodudesphoto.com';
