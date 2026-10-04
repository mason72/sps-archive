# Pixeltrunk

AI-powered photo archive for professional photographers. Sister product to SimplePhotoShare (spsv2).

Generic workflow, shipping, collaboration, and design rules are **global** (`~/.claude/CLAUDE.md` + `~/.claude/rules/`). This file is Pixeltrunk business logic only.

## Quick Reference

- **Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Supabase (pgvector), Cloudflare R2, Modal GPU, Inngest
- **Docs:** `docs/PRD.md` (product), `docs/TECHNICAL.md` (technical), `docs/OPS.md` (alpha access, metering, /ops, crons — read before touching auth/ops/usage), `docs/SESSION-HANDOFF.md` (handoff prompt)
- **Brand:** Elephant pixel-mosaic logo, Libre Baskerville wordmark, Playfair Display headlines, Inter body, stone/white palette with emerald accent

## Project Structure

- `src/app/` — Next.js App Router pages and API routes
- `src/components/` — UI components (button, upload, gallery, search)
- `src/lib/` — Business logic (supabase, r2, ai, upload, sps-integration)
- `modal/` — Python AI pipeline (CLIP, ArcFace, aesthetic scoring)
- `docs/` — PRD and technical documentation

## Key Patterns

- Presigned URL uploads (client -> R2 direct)
- AI processing via Modal serverless GPU
- pgvector for CLIP semantic search
- Smart Stacks group similar images, surface best shot
- AI suite (FULL DOC: `docs/AI.md` — read it before touching anything AI): SigLIP-2 semantic search (archive/editor/guest/selfie), face clustering + People view + identity-suggestion engine, scene sections + smart sections, group focal points. Settlement-triggered Inngest lanes, kill switch `AI_INDEXING_ENABLED`. Two invariants: AI writes ONLY its own columns (never `processing_status` or anything display reads), and AI suggests — humans apply. Modal CLI: `~/.venvs/modal-cli/bin/modal`
- Cover types (image/mosaic/solid/crossfade) — `src/lib/cover/*`; `normalizeCoverSettings()` is the single parse point; email/OG raster composes ONLY in the Inngest `cover-raster` job (pool.ts stays sharp-free for routes)
- **SPS import is a PULL that moves bytes** (built 2026-08-11; contract `tasks/sps-archive-pull-spec.md`, build notes `tasks/sps-pull-build-plan.md`). Pixeltrunk pulls; SPS never pushes. The old zero-copy push lane (`import.ts`, `POST /api/sps/import`, `event/imported`) is DELETED — it minted rows pointing at SPS's R2 keys on the false premise of a shared bucket (SPS serves `pub-7363d57d….r2.dev`, the archive stores `sps-prism`), so every row it made was a tile this app could not read. The lane now: `pull-client.ts` (protocol) → `pull-event.ts` (byte mover) → Inngest `sps-pull` → review UI at `/events/import`. Four invariants: **bytes land before the row exists** (no ghost-tile window at all — the inverse of the upload path, which must pre-create rows to presign); the walk is driven by **manifest page**, so signed URLs are always seconds old and `sps_pull_jobs.next_offset` is the resume point; completion is **the absence of `nextOffset`**, never a count (`imageCount` includes AI copies the manifest excludes); and `POST /pulled` fires **only after durable write**, because that call is what lets SPS delete its copy. Per-photo provenance lives on `images.sps_image_id / sps_quality / sps_pulled_at` with a unique index on `(event_id, sps_image_id)` — that index, not the importer's care, is what makes a resumed job idempotent. **A stalled pull heals itself** (2026-09-18, lesson 160, migration 084): `spsPullWatchdog` cancels a quiet job's zombie Inngest run (the one-run-per-job concurrency slot makes a zombie block every retry), re-sends at most twice, then alerts `sps.pull-stalled`. Progress for it is `images_done` ONLY, because a restart's re-walk re-counts landed photos as skipped. By hand: `src/lib/inngest/rest.ts` (`cancelLiveRuns`) or the manual event `sps/pull-watchdog.run`. **Job counters fold with ONE atomic increment, `sps_pull_add_progress` (migration 085)** — never read-add-write: six workers flush concurrently inside a slice, and the old fold lost Everpure 10 of 1,090 (lesson 161; probe `scripts/triage/sps-pull-progress-race.ts`). The screen's headline is `landed` (rows), not `images_done`. ⚠️ Inngest's Vercel integration once failed to register a NEW function on deploy, so `.github/workflows/inngest-sync.yml` now PUTs `https://app.pixeltrunk.com/api/inngest` after every successful Production deploy and goes RED unless the app answers "Successfully registered" (by hand: the same `curl -X PUT`, or re-run the workflow). Still trigger a new function once after its deploy. Verify with `npx tsx scripts/verify-sps-pull.ts <eventId>` (sha256 round-trip; inspection is not evidence here — that is how the lossy-source claim survived for months). **AI renders come across too (since 2026-09-02):** SPS's manifest sends them with `sourceImageId` (their file is SPS's `large_url`; the row says WebP, the bytes are JPEG); Pixeltrunk keeps `images.sps_source_image_id` (migration 076) and otherwise treats a render like any photo — Mason's call, made with the synthetic-face risk named, so that column is the ONE filter if renders ever leave clustering. `parseFilename` strips the `(AI) ` prefix so a render lands on the person's card, and the stored mime and extension follow the BYTES (`sniffImageMime` + `extensionForMime`), never the row's label or the name.
- **Highlights has ONE generator and two ways in** (`src/lib/highlights/`). By hand: an empty section named exactly "Highlights" shows the generator (propose → review/swap → Accept; `apply` is the only human write path). Automatically (2026-09-24, migration 086): the "Include a Highlights section" toggle on **Sort into sections** stores `sections.highlights_auto_count`, puts Highlights first, and `fillPendingHighlights()` (`auto-fill.ts`) fills it once AI has SETTLED. It is triggered by the face-cluster job, by the sort itself, and by the 30-minute sweep as a safety net (15 quiet minutes > the 10-minute cluster debounce). Mason's call: the picks go live without review. The tab shows "Auto-picked · Review" until a person accepts a re-run. Four invariants: **a count set = the machine owns the section**, and a human Accept clears it; **machine picks are never training data** (`direction.ts` skips sections with a count, or the generator would learn to agree with itself); **it never overwrites photos** (a sort only arms an EMPTY Highlights; a filled one, machine or human, is kept and moved first, because a person may have edited the machine's picks; a waiting section that gained members is handed back); and **guests never see it empty**, because the gallery payload drops empty sections. The fill CLAIMS the section (`highlights_auto_filled_at`, conditional on the same count) after the slow propose and before writing, so a person's Accept or a re-sort during the propose wins and a retry after success is a no-op. The taste learner is bounded (20 newest real sets, dumps >25% of their gallery skipped; lesson 167).
- **The SPS connection token is a stored plaintext credential, one row per user** (`sps_connections`, service-role only, RLS on with no policies). NOT an env var: SPS mints per `user_id`, so an env var pins the whole install to one SPS account. Note the asymmetry — SPS only *verifies* the token so it keeps a hash; Pixeltrunk must *present* it on every request so it must keep the plaintext. `getSpsToken()` in `connection.ts` is the only reader; it never reaches the browser, a log line, a `system_errors` blob, or an argv. Paste screen: `/settings/connections`, which validates against `GET /events` before storing (SPS shows the token once, so a truncated paste has to fail at the paste). Minting on the SPS side is gated behind `NEXT_PUBLIC_ENABLE_PIXELTRUNK`.
- **`/api/sps` is NO LONGER public in middleware** (2026-08-11) — only `/api/sps/enhancements`, the one route SPS calls server-side with no session. The old blanket rule dated from the push lane and would have left any new `/api/sps/*` route reachable without a session.
- **CORRECTED 2026-08-11: SPS is NOT a lossy source.** This file previously said "SPS re-compresses on ingest (~⅓ the bytes at identical dimensions), so it is a lossy source." That was measured honestly on FoU26 frames but generalized from *stored bytes* to *current behaviour*, and it is wrong: SPS `f406ee7` (2026-05-05) added a passthrough branch to `processImage`, so a JPEG upload with no test-mode watermark and no branding overlay is stored **byte-for-byte** as `original.jpg`. Verified by sha256 round-trip — a 3,583,248-byte camera JPEG comes back identical. The FoU26 frames predate the fix. SPS's `IMAGE_SIZES` still reads `quality: 95` because that encoder still runs for the excluded cases (watermarked/test events, branded events, HEIC/PNG/WebP), which is why reading the config alone gives the wrong answer. SPS now exposes a pull API that reports per-image `quality: 'archive' | 'lossy'` so this never has to be inferred again — spec in `tasks/sps-archive-pull-spec.md`.

## Design System

- **Fonts:** `font-brand` (Libre Baskerville — wordmark only), `font-editorial` (Playfair Display — headlines), `font-sans` (Inter — body)
- **Palette:** Tailwind stone (stone-900 primary, white surfaces, emerald accent)
- **Components:** Button variants (primary, secondary, ghost, danger), BrandButton (animated), lucide-react icons
- **Layout:** CSS columns masonry, `cn()` utility (clsx + tailwind-merge)
- **Card grids AUTO-FILL, they do not list breakpoints** (`CARD_GRID` in `EventList.tsx`): `repeat(auto-fill,minmax(min(300px,100%),1fr))`, so the column count is derived from the space available — 1 on a phone, 3 on a laptop, 5 at 2298px — and is right on hardware nobody has tested. Two traps, both measured rather than reasoned: **`auto-fit` is wrong here** because it collapses empty tracks, which stretches a 3-card pinned row to ~600px cards and breaks its alignment with the grid below; and **a bare `minmax(300px,…)` is a HARD floor** that lays out a 300px card inside a 256px container (escapes by 44px, scrolls the page sideways) — `min(300px,100%)` is what lets the last column shrink. The archive measure is `MEASURE` = 1800px, left-aligned with NO `mx-auto` so the grid shares the greeting's left edge. Width is for more cards, not bigger ones — the search **input** stays `max-w-xl` because it is the one control that gets worse with width. (`/intel` is 1400px and `/search` 896px; there is no app-wide measure, so match the page's content, not a global number.)

## Development

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # ESLint
npm run db:gen-types # Regenerate Supabase types
npm run typecheck    # tsc --noEmit on the WORKING tree; ~3s warm, includes scripts/ (no route types, no lint)
npm run hooks:install # once per clone: points core.hooksPath at scripts/git-hooks (pre-push type-checks + lints the PUSHED commit)
~/.venvs/modal-cli/bin/modal deploy modal/ai_pipeline.py  # Deploy AI pipeline (CLI lives in this venv)
```

## Hard-won gotchas

The curated list is `docs/GOTCHAS.md` (full log: `tasks/lessons.md`). **Read it before touching API routes, ingest, R2, faces, or the build/deploy path.** The three that have shipped incidents more than once:

- `getAuthUser()` returns the SERVICE client, which bypasses RLS: every query it feeds needs an ownership filter. This shipped as an IDOR twice.
- Never `npm run build` in a working directory where a dev server is running; they share `.next`. Build in a worktree instead.
- `scripts/` is in the production type check, so a throwaway probe that fails `tsc` fails the Vercel deploy. The pre-push hook (`npm run hooks:install`, per clone) type-checks the pushed commit.
