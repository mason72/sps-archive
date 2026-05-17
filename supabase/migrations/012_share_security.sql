-- Migration 012: Share & favorites security hardening
--
-- Closes audit P0 findings:
--   • shares.public-read: "Anyone can read active shares" exposed
--     password_hash and download_pin to the anon role. Anyone with the
--     project's anon key (which lives in client JS) could dump every
--     active gallery's hash + 4-digit PIN.
--   • favorites public-read leaked client_email / client_name across
--     every gallery.
--   • favorites public-delete (USING (true)) let anonymous visitors
--     wipe other people's favorites.
--
-- After this migration, ALL share / favorite reads + writes go through
-- the API routes (which use the service-role client and check share
-- ownership, slug-vs-shareId binding, allow_favorites, etc.). The new
-- resolve_share_by_slug RPC returns only the non-secret columns and is
-- the one path the anon role still has into the shares table.

-- ── Drop over-permissive policies ──
drop policy if exists "Anyone can read active shares"           on shares;
drop policy if exists "Anyone can add favorites on active shares" on favorites;
drop policy if exists "Anyone can view favorites"                on favorites;
drop policy if exists "Anyone can delete own favorites"          on favorites;

-- ── Service-role explicit policies (we already operate via service client) ──
create policy "Service role manages shares"
  on shares for all
  using (auth.role() = 'service_role');

create policy "Service role manages favorites"
  on favorites for all
  using (auth.role() = 'service_role');

-- ── Safe slug resolver for public gallery routes ──
-- Returns the subset of share columns needed to render the gate /
-- determine flow. Never exposes password_hash, download_pin, or
-- raw share.id (the share's UUID is sensitive because the legacy
-- cookie auth used it as a bearer token — Phase 0 replaces that
-- with HMAC, but we still don't want to leak it to anon clients).
create or replace function resolve_share_by_slug(p_slug text)
returns table (
  id                       uuid,
  event_id                 uuid,
  share_type               text,
  is_active                boolean,
  allow_download           boolean,
  allow_favorites          boolean,
  require_pin_bulk         boolean,
  require_pin_individual   boolean,
  has_password             boolean,
  expires_at               timestamptz,
  custom_message           text,
  image_ids                uuid[],
  section_id               uuid,
  person_id                uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.event_id,
    s.share_type,
    s.is_active,
    s.allow_download,
    s.allow_favorites,
    s.require_pin_bulk,
    s.require_pin_individual,
    (s.password_hash is not null) as has_password,
    s.expires_at,
    s.custom_message,
    s.image_ids,
    s.section_id,
    s.person_id
  from shares s
  where s.slug = p_slug
    and s.is_active = true
  limit 1;
$$;

-- Allow anon + authenticated to call the resolver (it returns no secrets).
grant execute on function resolve_share_by_slug(text) to anon, authenticated;
