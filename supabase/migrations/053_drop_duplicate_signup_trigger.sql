-- Drop the duplicate signup trigger.
--
-- auth.users carried THREE triggers, two of which fired the same function:
--
--   on_auth_user_created               -> handle_new_user()               (keep)
--   on_auth_user_created_subscription  -> handle_new_user_subscription()  (keep)
--   on_auth_user_subscription          -> handle_new_user_subscription()  (drop)
--
-- Both subscription triggers are AFTER INSERT FOR EACH ROW on the same table
-- running the same function, so every signup provisioned its subscription
-- twice. It was harmless — the function inserts with `on conflict (user_id) do
-- nothing`, so the second insert is a no-op — but it is duplicated work on the
-- alpha's front door, and the kind of thing that reads as significant to the
-- next person who finds it.
--
-- Found by the schema audit (2026-08-12) only after that audit was widened to
-- cover the `auth` schema. Scoped to `public`, it reported zero unversioned
-- triggers while three sat on auth.users, one of them in no migration at all.
-- This is the last object in the database that no file described.
--
-- Verified either side of this change with scripts/triage/signup-trigger-test.ts,
-- which creates a real auth user on the IANA-reserved example.com domain (no
-- mail can route there, and email_confirm suppresses the confirmation), asserts
-- that subscriptions and user_profiles rows appear, asserts there is exactly
-- ONE subscription row, then deletes the user and confirms the cascade removed
-- everything. Signup is not a thing to change on reasoning alone.

begin;

set local lock_timeout = '8s';

drop trigger if exists on_auth_user_subscription on auth.users;

commit;
