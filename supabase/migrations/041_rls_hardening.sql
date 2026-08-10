-- Codify live RLS state (2026-08-10 pre-alpha audit).
--
-- The live DB was hardened during the July IDOR remediation but the migration
-- files never caught up: 002 still creates "Anyone can read active shares"
-- (leaks password_hash + plaintext PINs cross-tenant via the anon key) and
-- "Anyone can view/delete favorites" (guest PII readable, rows deletable).
-- Neither policy exists live — guest routes go through the service client and
-- scope in code. These drops make a fresh environment match production.
-- Verified live 2026-08-10: anon PostgREST returns [] on shares, favorites,
-- usage_events, allowed_signups, system_errors.

drop policy if exists "Anyone can read active shares" on shares;
drop policy if exists "Anyone can view favorites" on favorites;
drop policy if exists "Anyone can delete own favorites" on favorites;
drop policy if exists "Anyone can create favorites" on favorites;
