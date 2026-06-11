-- Video support for the content pipeline.
--
-- Videos ride the existing images table (one media library, one membership
-- model). Posters are written into the existing thumbnails/{variant}/ key
-- scheme, so thumbnail_generated keeps gating display and site publication
-- for both media types.
--
-- Publishing lanes (decided at site-publication time, see src/lib/site/publish.ts):
--   - short muted clips (≤60s, no audio) → R2 public lane (poster + mp4)
--   - long or sound-on videos            → Cloudflare Stream (stream_uid)

alter table images
  add column media_type text not null default 'image'
    check (media_type in ('image', 'video')),
  add column duration_seconds real,
  add column has_audio boolean,
  add column stream_uid text,
  add column processing_error text;

comment on column images.media_type is
  'image | video — selects the thumbnail vs poster pipeline and the site publishing lane';
comment on column images.duration_seconds is
  'Video duration from ffprobe; null for images';
comment on column images.has_audio is
  'Video has an audio track (ffprobe); sound-on videos publish via Cloudflare Stream';
comment on column images.stream_uid is
  'Cloudflare Stream video UID once ingested (long or sound-on videos); cleared on unpublish';
comment on column images.processing_error is
  'Human-readable reason when processing_status = failed (e.g. unsupported codec)';

-- The editor and site APIs frequently scope to videos (badges, lane checks);
-- partial index keeps it free for the overwhelmingly-image common case.
create index idx_images_media_type_video on images (media_type)
  where media_type = 'video';
