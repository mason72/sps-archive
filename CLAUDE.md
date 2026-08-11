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
- **SPS integration is NOT zero-copy — the shared-bucket premise is false** (verified 2026-08-10). `import.ts` assumes SPS and Archive share one R2 bucket and only mints metadata rows; in reality SPS v2 serves from `pub-7363d57d….r2.dev` while the archive stores in `sps-prism`, so an import must MOVE BYTES or it creates ghost tiles. SPS also re-compresses on ingest (~⅓ the bytes at identical dimensions), so it is a lossy source. Working reference: `scripts/backfill-sps-fou26.ts` + `tasks/sps-fou26-backfill.md`.

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
~/.venvs/modal-cli/bin/modal deploy modal/ai_pipeline.py  # Deploy AI pipeline (CLI lives in this venv)
```

## Hard-won gotchas (full log: `tasks/lessons.md` — skim it before touching API routes)

- **`getAuthUser()` hands back the SERVICE client, which bypasses RLS.** Every query in every route it feeds must carry an ownership filter (`.eq("user_id", ...)` or `events!inner(user_id)` join). This exact omission shipped as an IDOR twice (lessons #2 and #14) — when touching an API file, scan its siblings for the same hole.
- **Never run `npm run build` while a dev server is up *in the same working directory*** — they share `.next` and the build corrupts the running server (has bitten three separate times). `main` auto-deploys to Vercel, so `next build` (not just tsc) must pass before every commit. **A git worktree is a different working directory and has its own `.next`**, so building in `.claude/worktrees/<name>/` is safe while a dev server runs in the main checkout — the test is the process's cwd, not the port. Confirm with `lsof -p <pid> -a -d cwd -Fn`, and run that check as its own command: batching it into the same invocation as the build means you read the answer after the build has already run.
- **The repo lives in iCloud-synced ~/Documents.** Sync races drop conflict copies (`file 2.ts`) inside `.next` → phantom duplicate-identifier tsc errors. tsconfig excludes them; if a ` N.ts` file errors, it's iCloud, not the code. Edits can also silently fail to apply — verify Edits landed before building.
- **Upsert `onConflict` must exactly match a LIVE unique constraint** — check `pg_constraint` on the live DB, not the migration file. Optimistic UI masks failed writes; guest favorites 500'd for months unseen.
- **Streaming routes need `maxDuration`, parallel prefetch, and real backpressure** — the ZIP export shipped corrupt 1.6GB files when Vercel killed a sequential-fetch stream at the 300s default. `store: true` for JPEG zips.
- **DATE columns format with `timeZone: "UTC"`**; timestamps format local.
- **Upload rows are presign-created BEFORE their binary exists** — any new exit path from an upload session (cancel, unload, error) must clean its rows up or they become ghost tiles (lessons #21–23, the eBay incident). The client may only mark "complete" on a server-confirmed 2xx; `/api/upload/reconcile` truth-checks each batch; the Inngest `upload-reconciler` (nightly 2:43am PT + `reconciler/run` event) heals or deletes stragglers and emails a report.
- **Gallery passwords are event-level with write-through, and have exactly one write home:** `PUT /api/events/[eventId]/gallery-password`. It writes the plaintext to `events.settings.sharing.password` (owner-scoped JSONB — the photographer must be able to read it back, and the email composer must be able to print it) AND re-hashes into `password_hash` on every **active** share. Never write one side alone: the plaintext without the hashes is a gallery the owner thinks is locked, and the hashes without the plaintext breaks the email toggle. `POST /api/shares` inherits the event password unless the body explicitly supplies one — a posture, not a default (lesson 35).
- **What a share exposes to a guest has exactly one resolver: `resolveShareImageScope()`** (`src/lib/gallery/share-scope.ts`). Every guest read path (gallery payload, cover, OG card, search, selfie-search, downloads, favorites writes) asks it, and it fails CLOSED — a `share_type` it doesn't know how to narrow serves nothing. `shareScopeIdFilter()` returns `null` only for a genuinely unrestricted share and an EMPTY set for a denied one, so a caller that forgets the 404 branch still shows nothing. Never re-inline `share_type === "selection"` at a call site; adding `section`/`person` shares means adding a case to that switch (lesson 55).
- **`database.types.ts` is GENERATED — never hand-edit it.** `npm run db:gen-types` (wrapper: `scripts/gen-types.sh`) generates to a temp path, sanity-checks line count + required symbols, then moves into place; it reads the access token from the `supabase-access-token` keychain item. The types check the **table name** and the **result Row shape** — they do NOT check `.eq()` filter columns, so a filter on a nonexistent column still compiles and fails at runtime as a 400 (lessons #49–51).
- **The share cover has ONE resolver: `resolveShareCoverUrl()` (`src/lib/cover/resolve-share-cover.ts`).** The durable email-hero redirect, the email composer's decision to attach a hero at all, and `EmailPreview` all go through it. A caller that re-derives "does this share have a cover" will drift from the route that answers it — that fork shipped a dead `<img>` in every email for 4 of 8 live selection shares. Internally it scopes through `resolveShareImageScope()` (the line above) — the two single-homes compose, they don't compete. E2E: `npx tsx scripts/verify-share-cover.ts <apiBase>`.
- **A Supabase error is a return value, not a throw** — `const { data } = await …` followed by `data || []` turns a 400 into a believable empty result. Check `result.error` on any query whose emptiness would look plausible. `shares`/`favorites`/`images` have no `user_id`; scope them via `.in("event_id", eventIds)` or an `events!inner(user_id)` join.
- **Sort is PER SECTION** (`sections.sort_mode`/`sort_seed`, migration 045; NULL inherits the event default). The editor's dropdown writes to the ACTIVE section — only "All Images" writes the event setting — and the guest gallery renders each tab in its own section's order. "random" is seeded SERVER-side so every client sees the same shuffle until it's deliberately reshuffled.
- **Archive card covers honor cover TYPE**, not a leftover `cover.imageId` (mosaic/color show their composed raster; photo fallbacks anchor on `focal_x/y`, preferring a frame that has one). Same class of bug as the email hero: a caller that re-derives what another surface decides will drift from it.
- **People index (`/people`)** is archive-wide and INTERNAL; identity comes from `personNameFromParts` (never re-derive names) — full doc in `docs/OPS.md`. Membership has ONE predicate, `personKeyForImage()` (`src/lib/people/index-people.ts`), shared by the index count, the spotlight payload, and the `?person=` deep link the event chips use; it is raw identity, so a name arriving from a URL gets `looksLikePersonName` first. Clicking a face opens the spotlight — never a bare link into an event, which is how "77 photos" became a 5,787-image event filtered to nothing.
- **The guest gallery and the owner's preview are ONE component** (`src/components/gallery/GalleryExperience.tsx`), rendered by `/gallery/[slug]` and `/gallery/preview/[eventId]`. They differ only by `apiBase` and a four-flag `capabilities` object (favorites / tracking / passwordGate / downloads). Never fork them again — the 609-line preview copy had silently drifted to filename-only search with no selfie search, so a preview answered "is this what my client sees?" with a confident wrong yes (lesson 70). Selfie MATCHING likewise has one home, `matchSelfie()` (`src/lib/faces/selfie-match.ts`), shared by both search routes.
- **Gallery status is TWO independent axes** (`src/lib/events/status.ts`): a delivery ladder (draft → published → sent → opened → downloaded) and pipeline readiness (uploading / indexing). They must never merge — a gallery is routinely sent while its AI processing is still queued. Delivery evidence is a VIEW, not an email: 6 of 15 live galleries were opened without an email ever leaving Pixeltrunk, so "we sent an email" is not the definition of shared.
- **A stale `pending` row blocks an event's entire AI pipeline.** `countPendingUploads()` only counts rows younger than `PENDING_UPLOAD_STALE_MINUTES` (30) — before that gate, nine ghost rows out of 5,787 kept `ai-index` returning `skipped: "uploads-in-flight"` forever, which also meant `faces/cluster.requested` never fired. "Dismiss" on the stalled-uploads banner now `DELETE`s those rows for real (HEAD in R2 first; rows whose bytes landed are left for the reconciler) — it used to write a localStorage flag and nothing else (lesson 67).
- **Selfie search is ON by default** (2026-08-10) and read ONLY through `selfieSearchEnabled()` — absent means enabled, explicit `false` is the opt-out. Events store `{}` and all sharing defaults resolve at read time, so a `=== true` check silently pins every existing event to the OLD default; that's the trap for any future default flip in `SharingSettings`.
- **Alpha ops invariants (full doc: `docs/OPS.md`):** signup is table-gated (`allowed_signups`) with public Supabase signups disabled at the project level; `is_admin` belongs ONLY to mason@ (never the shared info@ team login); admin gates check `realUser` (act-as can't leak /ops); every /ops PAGE awaits `assertAdminPage()` BEFORE fetching — a layout is not a security boundary under streaming SSR, and access control is verified with raw curl. `recordUsage()` is always awaited; prices exist only in `src/lib/usage/costs.ts`; per-user cost math only via `getUsageOverview()`.
- **API catch blocks call `reportSystemError(context, err, detail)`** (`src/lib/monitoring/report.ts`) — never bare `console.error` alone. It writes a queryable `system_errors` row + throttled admin email (needs `ADMIN_ALERT_EMAIL`, set in Vercel, NOT in local .env).
