# Pixeltrunk

AI-powered photo archive for professional photographers. Sister product to SimplePhotoShare (spsv2).

Generic workflow, shipping, collaboration, and design rules are **global** (`~/.claude/CLAUDE.md` + `~/.claude/rules/`). This file is Pixeltrunk business logic only.

## Quick Reference

- **Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 4, Supabase (pgvector), Cloudflare R2, Modal GPU, Inngest
- **Docs:** `docs/PRD.md` (product), `docs/TECHNICAL.md` (technical), `docs/SESSION-HANDOFF.md` (handoff prompt)
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
- Auto Sections from AI scene classification
- SPS integration via shared R2 bucket (zero-copy imports)

## Design System

- **Fonts:** `font-brand` (Libre Baskerville — wordmark only), `font-editorial` (Playfair Display — headlines), `font-sans` (Inter — body)
- **Palette:** Tailwind stone (stone-900 primary, white surfaces, emerald accent)
- **Components:** Button variants (primary, secondary, ghost, danger), BrandButton (animated), lucide-react icons
- **Layout:** CSS columns masonry, `cn()` utility (clsx + tailwind-merge)

## Development

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm run lint         # ESLint
npm run db:gen-types # Regenerate Supabase types
modal deploy modal/ai_pipeline.py  # Deploy AI pipeline
```

## Hard-won gotchas (full log: `tasks/lessons.md` — skim it before touching API routes)

- **`getAuthUser()` hands back the SERVICE client, which bypasses RLS.** Every query in every route it feeds must carry an ownership filter (`.eq("user_id", ...)` or `events!inner(user_id)` join). This exact omission shipped as an IDOR twice (lessons #2 and #14) — when touching an API file, scan its siblings for the same hole.
- **Never run `npm run build` while the dev server is up** — they share `.next` and the build corrupts the running server (has bitten three separate times). `main` auto-deploys to Vercel, so `next build` (not just tsc) must pass before every commit.
- **The repo lives in iCloud-synced ~/Documents.** Sync races drop conflict copies (`file 2.ts`) inside `.next` → phantom duplicate-identifier tsc errors. tsconfig excludes them; if a ` N.ts` file errors, it's iCloud, not the code. Edits can also silently fail to apply — verify Edits landed before building.
- **Upsert `onConflict` must exactly match a LIVE unique constraint** — check `pg_constraint` on the live DB, not the migration file. Optimistic UI masks failed writes; guest favorites 500'd for months unseen.
- **Streaming routes need `maxDuration`, parallel prefetch, and real backpressure** — the ZIP export shipped corrupt 1.6GB files when Vercel killed a sequential-fetch stream at the 300s default. `store: true` for JPEG zips.
- **DATE columns format with `timeZone: "UTC"`**; timestamps format local.
- **Upload rows are presign-created BEFORE their binary exists** — any new exit path from an upload session (cancel, unload, error) must clean its rows up or they become ghost tiles (lessons #21–23, the eBay incident). The client may only mark "complete" on a server-confirmed 2xx; `/api/upload/reconcile` truth-checks each batch; the Inngest `upload-reconciler` (nightly 2:43am PT + `reconciler/run` event) heals or deletes stragglers and emails a report.
- **API catch blocks call `reportSystemError(context, err, detail)`** (`src/lib/monitoring/report.ts`) — never bare `console.error` alone. It writes a queryable `system_errors` row + throttled admin email (needs `ADMIN_ALERT_EMAIL`, set in Vercel, NOT in local .env).
