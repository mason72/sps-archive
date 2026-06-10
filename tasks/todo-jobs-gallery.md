# TDP Work jobs gallery + /api/site/jobs

Spec: /Users/mjfoster/Documents/Projects/TDP/tdp-website/tasks/pt-jobs-gallery-brief.md
Design decisions (agreed with Mason 2026-06-10):
- Job sections live in a dedicated "TDP Work" gallery (slug `tdp-work`, settings.work=true).
- Each job section gets `site_scene_key = "job/<slug>"` → the existing publication
  gate, revalidate scoping, focal tool, and locks all work unchanged.
- Job metadata in `sections.job_meta jsonb`, validated in app code (no zod dep).
- Slug freezes at creation (derived from section name), editable in the form.
- Incomplete jobs (missing required fields) are omitted from the API; editor
  shows a Live / Not-live badge with the missing-field checklist.
- Smart prefills: year from images' taken_at, city from source-event city,
  alias + industry from a small known-brands map, alias fallback composed from
  industry + event size.

## Tasks

- [x] Migration 022: `sections.job_meta jsonb` + scaffold the TDP Work gallery
- [x] Hand-update database.types.ts (job_meta on sections)
- [x] src/lib/site/jobs.ts — enums/labels (mirroring the website's jobs.ts),
      slugify, validateJobMeta, jobMissingFields, serializeJob (anonymize-safe),
      KNOWN_CLIENTS map, alias/industry suggestion helpers
- [x] src/lib/site/jobs.test.ts — 19 tests: validation, completeness,
      anonymize never leaks client, suggestions
- [x] GET /api/site/jobs — X-SPS-Key auth, ordered jobs, scene-shaped images,
      cover first, private/max-age=300
- [x] POST /api/sections — assign job/<slug> key when event is the work gallery
- [x] PATCH /api/sections/[id] — jobMeta + jobSlug edits, fires revalidate
      (job sections only), 409 on slug collision
- [x] PUT /api/sections/reorder — fire revalidate when the work gallery reorders
- [x] GET /api/events/[id] — include jobMeta in sections payload
- [x] JobDetailsModal — full form with prefills + completeness checklist
- [x] page.tsx — job banner (status + edit button), modal wiring, work-gallery
      upload gating before first job
- [x] EventSidebar/SectionRow — "New job…" input, auto-open form on create,
      live/not-live dot
- [x] ImageGrid — cover chip on the first tile of a job section
- [x] docs/SITE-INTEGRATION.md — jobs model section + verification steps
- [x] npm run lint (clean) && npm run test (122 pass) && npm run build (green)
- [x] Migration applied to live (hfusdrtrizabzzcdhnyy); e2e curl acceptance:
      job with public URLs cover-first ✓; anonymized job → alias + client:null,
      name absent from payload ✓; image URL 200s with no auth ✓; missing
      required field → job omitted ✓; no key → 401 ✓; Cache-Control
      private,max-age=300 ✓; /api/site/scene/hero unchanged (22 images) ✓;
      featured-work returns its true (empty) set ✓. Test section cleaned up.
- [x] Touchups (MUA) flag added per updated brief: JobMeta.touchups boolean,
      "Hair + makeup touchups on site" toggle in the form, API always returns
      a boolean (false when unset — verified live for both a checked job and
      a legacy doc without the key; webhook path is the same jobMeta PATCH).
- [ ] Commit; confirm with Mason before push (main auto-deploys)

## Review

Shipped the TDP Work jobs model end to end. Key design: job sections reuse
site_scene_key ("job/<slug>") so publication, webhook scoping, focal tool,
and locks needed zero changes — the only schema addition is one jsonb column.
The anonymity contract is enforced in exactly one place (serializeJob).
Draft jobs (incomplete required fields / no photos) are omitted from the API
and clearly badged in the editor. Webhook scoping verified at the three call
sites (jobMeta/jobSlug PATCH, publication sync, work-gallery section reorder);
client-gallery mutations cannot reach any of them. Editor UI verified by
build + types; worth a quick visual pass in the browser when Mason opens
TDP Work for the first time.
