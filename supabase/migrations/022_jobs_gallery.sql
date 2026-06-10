-- 022_jobs_gallery.sql
--
-- "TDP Work" jobs gallery: the website's Featured Work becomes job-based —
-- each SECTION of this dedicated gallery is one job (e.g. "ServiceNow
-- Knowledge 25"); its images are that job's gallery and the first image by
-- drag order is the cover. Job sections carry site_scene_key = 'job/<slug>'
-- (slug frozen at creation, derived from the section name), so the existing
-- v2 machinery — publication gate (site_scene_key IS NOT NULL), revalidate
-- webhook scoping, focal-point tool, section locks — applies unchanged.
--
-- Job metadata (client, anonymize/alias, city, services, size/duration/teams/
-- ballpark/industry/year) lives on the section as one jsonb document,
-- validated in app code (src/lib/site/jobs.ts — the only writer). The site
-- reads jobs via GET /api/site/jobs; sections missing required fields are
-- omitted until complete.

ALTER TABLE sections ADD COLUMN IF NOT EXISTS job_meta jsonb;

COMMENT ON COLUMN sections.job_meta IS
  'Job infosheet metadata for TDP Work gallery sections (site_scene_key = job/<slug>). Shape validated in src/lib/site/jobs.ts. NULL everywhere else.';

-- Scaffold the gallery itself (no sections — jobs are team-created). Owner:
-- whoever owns the TDP Website gallery; fall back to the first user.
DO $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT user_id INTO owner_id FROM events WHERE slug = 'tdp-website' LIMIT 1;

  IF owner_id IS NULL THEN
    SELECT id INTO owner_id FROM auth.users ORDER BY created_at LIMIT 1;
  END IF;

  IF owner_id IS NULL THEN
    RAISE NOTICE 'No users yet — skipping TDP Work gallery scaffold.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM events WHERE slug = 'tdp-work') THEN
    INSERT INTO events (user_id, name, slug, description, event_type, settings)
    VALUES (
      owner_id,
      'TDP Work',
      'tdp-work',
      'Two Dudes Photo featured work — each section is one job on the website.',
      'website',
      '{"work": true}'::jsonb
    );
  END IF;
END $$;
