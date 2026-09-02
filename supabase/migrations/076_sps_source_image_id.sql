-- 076: provenance for AI renders pulled from SPS.
--
-- SPS's archive manifest excluded AI-styled renders until 2026-09-02 (spec:
-- "generated renders with no camera file behind them"). Mason reversed that
-- from the import review of a booth event, where the renders are the images
-- guests actually shared: "None of the AI images imported either — this is a
-- problem." His call on placement: import them and index them like any photo.
--
-- Non-null = this row is a render, and the value is the SPS id of the capture
-- it was made from. When that capture was pulled too, it is the sibling row
-- whose sps_image_id matches. If indexing renders ever has to stop — a
-- stylised guest becoming their own reference face is the risk that was
-- named — THIS column is the one filter (`where sps_source_image_id is null`
-- on the clustering and reference reads), never the "(AI) " filename prefix,
-- which is a naming convention parse-filename.ts strips for people/stacks.

alter table images add column if not exists sps_source_image_id uuid;

comment on column images.sps_source_image_id is
  'SPS id of the capture this AI render was generated from. NULL on every real photograph. Provenance only; nothing in display or indexing reads it (2026-09-02).';

-- Event-scoped partial index: the read that would ever want this is "the
-- renders in this event", and the column is NULL on the vast majority of rows.
create index if not exists idx_images_sps_source_image
  on images(event_id, sps_source_image_id)
  where sps_source_image_id is not null;
