-- 020_website_gallery.sql
--
-- Website content model v2: the "TDP Website" gallery.
--
-- v1 tagged individual images with images.site_scene — write-easy but
-- read-impossible ("can't backtrace what's assigned where"). v2 replaces it
-- with ONE dedicated gallery whose SECTIONS are the site's content slots:
-- membership in a section IS publication. Pool sections feed rotating grids;
-- slot sections (slot/*) are explicit single-image positions where the first
-- image by section_images.sort_order wins.
--
-- Scene keys live on sections.site_scene_key (unique). The registry is in app
-- code (src/lib/site/scenes.ts) and sections are also scaffolded lazily there,
-- so adding a scene later needs no migration. The scaffold below exists so the
-- v1 → v2 data migration in this file has sections to target.
--
-- images.site_scene is DEPRECATED after this migration: app code no longer
-- reads or writes it. Values are left in place as an audit trail; a future
-- migration can drop the column once v2 has soaked.

-- Sections become addressable as website scenes.
ALTER TABLE sections ADD COLUMN IF NOT EXISTS site_scene_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_site_scene_key
  ON sections(site_scene_key) WHERE site_scene_key IS NOT NULL;

-- Focal point for slot images (percentages, 0-100, NULL = unset). The site
-- maps these to CSS object-position so art-directed crops keep the subject.
-- Range is validated in app code (PATCH /api/images/[imageId]).
ALTER TABLE images ADD COLUMN IF NOT EXISTS focal_x real;
ALTER TABLE images ADD COLUMN IF NOT EXISTS focal_y real;

DO $$
DECLARE
  owner_id uuid;
  gallery_id uuid;
BEGIN
  -- Owner: whoever curated the v1 scenes; fall back to the first user.
  SELECT e.user_id INTO owner_id
  FROM images i JOIN events e ON e.id = i.event_id
  WHERE i.site_scene IS NOT NULL
  GROUP BY e.user_id ORDER BY count(*) DESC LIMIT 1;

  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  END IF;

  IF owner_id IS NULL THEN
    RAISE NOTICE 'No users yet — skipping website gallery scaffold (app code creates it lazily).';
    RETURN;
  END IF;

  -- The gallery itself.
  SELECT id INTO gallery_id FROM events WHERE slug = 'tdp-website';
  IF gallery_id IS NULL THEN
    INSERT INTO events (user_id, name, slug, description, event_type, settings)
    VALUES (
      owner_id,
      'TDP Website',
      'tdp-website',
      'Two Dudes Photo website content — each section is a slot on the site.',
      'website',
      '{"website": true}'::jsonb
    )
    RETURNING id INTO gallery_id;
  END IF;

  -- Sections = the site's content slots. Keep names/keys/order in sync with
  -- src/lib/site/scenes.ts (which also scaffolds any later additions).
  INSERT INTO sections (event_id, name, sort_order, is_auto, site_scene_key)
  SELECT gallery_id, v.name, v.ord, false, v.key
  FROM (VALUES
    -- Pools (rotating grids)
    ('Hero Pool',                          'hero',                              0),
    ('Featured Work',                      'featured-work',                     1),
    ('Backgrounds',                        'backgrounds',                       2),
    ('Headshot Booth',                     'service/headshot-booth',            3),
    ('Photo Booth',                        'service/photo-booth',               4),
    ('Photo Booth — Overhead',             'photo-booth/overhead',              5),
    ('Photo Booth — B&W Glam',             'photo-booth/bw-glam',               6),
    ('Photo Booth — Custom Sets',          'photo-booth/custom-sets',           7),
    ('Anti-Booth',                         'service/anti-booth',                8),
    ('Event Photography',                  'service/event-photography',         9),
    ('Video',                              'service/video',                    10),
    ('Environmental Portraits',            'service/environmental-portraits',  11),
    ('Office Headshots',                   'service/office-headshots',         12),
    ('Drop-In Sessions',                   'service/drop-in-sessions',         13),
    -- Slots: homepage angled services row
    ('Slice 01 — Headshot Booth',          'slot/slice-1',                     14),
    ('Slice 02 — Photo Booth',             'slot/slice-2',                     15),
    ('Slice 03 — Anti-Booth',              'slot/slice-3',                     16),
    ('Slice 04 — Event Photography',       'slot/slice-4',                     17),
    ('Slice 05 — Video',                   'slot/slice-5',                     18),
    ('Slice 06 — Environmental Portraits', 'slot/slice-6',                     19),
    -- Slots: service-page heroes
    ('Hero — Headshot Booth',              'slot/hero/headshot-booth',         20),
    ('Hero — Photo Booth',                 'slot/hero/photo-booth',            21),
    ('Hero — Anti-Booth',                  'slot/hero/anti-booth',             22),
    ('Hero — Event Photography',           'slot/hero/event-photography',      23),
    ('Hero — Video',                       'slot/hero/video',                  24),
    ('Hero — Environmental Portraits',     'slot/hero/environmental-portraits', 25),
    ('Hero — Office Headshots',            'slot/hero/office-headshots',       26),
    ('Hero — Drop-In Sessions',            'slot/hero/drop-in-sessions',       27)
  ) AS v(name, key, ord)
  ON CONFLICT (site_scene_key) WHERE site_scene_key IS NOT NULL DO NOTHING;

  -- Migrate v1 per-image tags into section membership. Membership points at
  -- the ORIGINAL image rows (cross-event) — the source event keeps providing
  -- name/city for Featured Work captions. sort_order preserves the v1 API
  -- ordering (featured first, then manual display_order, then newest).
  INSERT INTO section_images (section_id, image_id, sort_order)
  SELECT s.id, i.id,
         row_number() OVER (
           PARTITION BY i.site_scene
           ORDER BY i.featured DESC, i.display_order ASC, i.created_at DESC
         ) - 1
  FROM images i
  JOIN sections s ON s.site_scene_key = i.site_scene AND s.event_id = gallery_id
  WHERE i.site_scene IS NOT NULL
  ON CONFLICT (section_id, image_id) DO NOTHING;
END $$;
