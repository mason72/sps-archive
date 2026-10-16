-- 096: mark cover uploads explicitly (2026-10-15, lesson 184).
--
-- A cover uploaded from the Design tab posts with `skipSection`, so it is an
-- `images` row with no section link: usually a client logo or banner. It still
-- gets a thumbnail and AI indexing, and readers that took "every row of the
-- event" as "every photo" picked it as a Highlight, showed it in the guest
-- "All" tab and Download All, sorted it into sections and carded it on
-- /people ("FM Logo", "What IF logo").
--
-- Why a FLAG and not "no section link means cover": a real photo can lose its
-- last link through other bugs (a section delete past 1,000 links, a failed
-- move between sections), and one had (Kara Pierce, Fivetran SKO). Inferring
-- "logo" from a missing link would hide such a photo everywhere, silently and
-- for good. A positive mark fails the other way: an unmarked logo shows up,
-- which is visible and fixable. Readers filter `is_cover_upload = false`.
--
-- The default is false, which is right for every insert path except one: the
-- upload route sets true when `skipSection` is sent (the only way a cover row
-- is made). The SPS pull, the Pixieset ingest and the website lane insert
-- photos and keep the default.
--
-- Backfill names its 16 rows by id. They were listed as every row with no
-- section link on 2026-10-15 after the one real photo among them was filed
-- back into its section, and each was checked by filename (the two ambiguous
-- ones, "thumbnail.jpg" and "Festival+Banner.webp", by eye: a title card and
-- an illustrated banner).
--
-- event_readiness stops counting cover uploads as photos, so a fresh logo no
-- longer reads as "Processing 4,748 of 4,749". Same signature, so it is
-- replaced in place; grants re-stated to match 083.

set lock_timeout = '5s';

alter table images
  add column if not exists is_cover_upload boolean not null default false;

comment on column images.is_cover_upload is
  'A cover uploaded from the Design tab (skipSection): branding, not a gallery photo. Readers of an event''s photos filter it out (lesson 184).';

update images set is_cover_upload = true
where id in (
  '5deaa9d7-3f76-4e31-b46c-b788456703c9', -- 2026 Community Summit, LogoColor.png
  '8dd7b103-dd49-4092-8c2a-045f26742c9c', -- Appfolio | San Diego, fb-icon-554x554.png
  'a49190f0-1cd3-4624-925f-165d11c2ef8c', -- BridgeBio 2026 NSM, FartherFaster_RGB.png
  'aaa14878-85a2-4938-a37a-5c6979ce9306', -- College Board 2026 All SDP, 4kWide2 Invert.jpg
  '45b2aa1a-b88f-4034-a8fa-f5911290a7a6', -- FM Headshots // Jul 2026, FM_Logo.jpg
  '9c26625e-d213-4d80-8ee2-0827c779033e', -- Future of Us Festival 2026, Festival+Banner.webp
  'c2a3b603-e880-4518-9b1c-03d1ca0dd2f4', -- Future of Us Festival 2026, FoU_Square_Title.png
  'e80beb32-21a2-40ad-8e0d-54de58316a3d', -- Hotel Data Conference 2026, 4kWide2 Invert.jpg
  '5ada60f3-5b18-4ae0-8dc0-91b4f0347e20', -- Jordan x KFL BTS // Chicago, banner
  '54c0ed6d-912a-4bb2-b431-cd32941b684b', -- Jordan x KFL BTS // LA 2026, banner
  '7adf6f54-0569-4776-a009-43ff2df954f5', -- Jordan x KFL BTS // NYC 2026, banner
  '254b1594-e763-47a3-ad31-5a0a64bd9446', -- PG&E Headshots // Jul 2026, PG&E logo
  'f28a60ca-34a4-4868-a711-38957c658253', -- What If? Summit 2026, thumbnail.jpg (title card)
  '5edfb8d0-d820-49e2-857b-e8ba64e8f887', -- What If? Summit 2026, What IF_ logo.jpg
  '0d1f3678-459e-4353-91d9-f2b2ac58510d', -- What If? Summit 2026, What IF_ logo.jpg
  'ea4e056c-9785-4382-a5a7-b1ca608a473c'  -- What If? Summit 2026, What IF_ logo.png
);

create or replace function public.event_readiness(p_event_ids uuid[], p_max_attempts int default 3)
returns table (
  event_id uuid,
  total bigint,
  indexed bigint,
  uploading bigint,
  stalled bigint,
  all_rows bigint,
  gave_up bigint
)
language sql
stable
as $$
  select
    i.event_id,
    count(*) filter (
      where i.media_type = 'image' and i.processing_status = 'complete'
        and not i.is_cover_upload
    ) as total,
    count(*) filter (
      where i.media_type = 'image'
        and i.processing_status = 'complete'
        and i.ai_indexed_at is not null
        and not i.is_cover_upload
    ) as indexed,
    count(*) filter (
      where i.processing_status = 'pending'
        and i.created_at > now() - interval '30 minutes'
        and not i.is_cover_upload
    ) as uploading,
    count(*) filter (
      where i.processing_status = 'pending'
        and i.created_at <= now() - interval '30 minutes'
        and not i.is_cover_upload
    ) as stalled,
    count(*) as all_rows,
    count(*) filter (
      where i.media_type = 'image'
        and i.processing_status = 'complete'
        and i.ai_indexed_at is null
        and i.ai_index_attempts >= p_max_attempts
        and not i.is_cover_upload
    ) as gave_up
  from images i
  where i.event_id = any(p_event_ids)
  group by i.event_id;
$$;
comment on function public.event_readiness(uuid[], int) is
  'Per-event readiness counts in one grouped pass: settled photos (total), AI-indexed, uploading, stalled, every row, and gave_up (unindexed after p_max_attempts Modal failures). Cover uploads (is_cover_upload) are not photos and are left out of every count but all_rows. Readiness = indexed + gave_up >= total.';

revoke all on function public.event_readiness(uuid[], int) from public, anon, authenticated;
grant execute on function public.event_readiness(uuid[], int) to service_role;
