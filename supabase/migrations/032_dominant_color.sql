-- G1: per-image dominant color ("#RRGGBB"), computed by sharp at thumbnail
-- time. Gallery grids paint it as the loading placeholder so tiles glow in
-- the photo's own hue instead of flat stone — the "magazine layout" feel
-- while images stream in. Backfilled for existing images by
-- scripts/backfill-dominant-color.ts.

alter table images add column dominant_color text;
