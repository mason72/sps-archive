# Session Handoff Prompt

Copy everything below the line into a new Claude Code session.

---

## Context: Pixeltrunk (SPS Archive)

**Repo:** `https://github.com/mason72/sps-archive`

I'm building **Pixeltrunk**, an AI-powered photo archiving and organization tool for professional photographers. Sister product to **SimplePhotoShare (SPS/spsv2)** — SPS handles client gallery delivery, Pixeltrunk handles the step before: organizing, culling, and storing the raw shoot output.

### Current state

The codebase is **95% feature-complete** with a fully wired upload → AI → organize → share pipeline. It's scaffold-complete but **not yet deployed**. The local session has API keys for Supabase, Stripe, and Vercel — please use them to complete wiring.

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase (PostgreSQL + pgvector), Cloudflare R2, Modal (serverless GPU), Inngest, sharp, exifr, Stripe.

---

### What's fully built

**Database** — 9 migrations, all applied:
- `events`, `images` (with `clip_embedding vector(768)`, `scene_tags`, `aesthetic_score`, `sharpness_score`), `faces` (with `embedding vector(512)`), `persons`, `stacks`, `sections`, `section_images`, `shares`, `favorites`, `event_templates`, `waitlist`
- RLS policies on all user-scoped tables
- Two RPC functions for vector similarity search

**40+ API routes** — all wired:
- Auth: signup, login, forgot-password, OAuth callback
- Events: CRUD, analyze, processing-status, share-readiness
- Images: CRUD, batch update
- Upload: presigned URL generation, completion with EXIF + Inngest trigger
- Shares: create links, public gallery access, PIN/password verification, downloads, favorites
- Sections: CRUD, reorder, image listing
- Search: unified filename + semantic CLIP vector search
- Stripe: checkout, webhook, customer portal
- Account: profile, subscription, logo upload
- Email: template CRUD, send to gallery clients
- Waitlist, Inngest webhook, stats

**23 pages:**
- Public: homepage, login, signup, forgot/reset password, public gallery viewer
- App: event list, create event, event detail, share config, global search, account, email settings
- Marketing: pricing page
- Dev: mockups, button showcase, playground

**4 Inngest functions** (all registered and wired):
1. `processUploadedImage` — thumbnails (3 sizes via sharp) → Modal AI (CLIP + ArcFace + aesthetic) → save to Supabase → check completion
2. `buildEventStacks` — face stacks → burst stacks → auto sections → trigger analysis
3. `processImportedEvent` — SPS import fan-out (zero-copy from shared R2)
4. `analyzeEvent` — AI event type detection → template matching → auto-apply sections

**Modal AI pipeline** (`modal/ai_pipeline.py`) — code complete, ready to deploy:
- CLIP ViT-L/14: 768-dim embeddings + 25-category scene classification
- ArcFace/insightface: face detection + 512-dim embeddings + eyes-open
- Aesthetic scoring: sharpness + exposure + composite quality
- Endpoints: `process_image`, `embed_text`, `analyze_event_sample`

**AI algorithms** (all implemented in `src/lib/ai/`):
- Smart Stacks: face-based (aesthetic 40% + sharpness 30% + eyes-open 30%) and burst-based (2s threshold, aesthetic 60% + sharpness 40%)
- Auto Sections: scene-tag based (3+ images threshold, timeline ordered), headshot-alphabetical
- Event Analysis: type detection (wedding/corporate/headshot/portrait/event), EXIF summary, time-gap detection, event splitting
- Event Templates: 5 built-in templates with predefined sections, user-template matching

**Processing status endpoint** — reports stage: `processing` → `analyzing` → `ready`

**Design system:** Stone palette (stone-900 primary), Libre Baskerville + Inter typography, lucide-react icons, CSS columns masonry

---

### What needs to happen next

**Priority 1 — Deploy & connect services:**

1. **Run remaining Supabase migrations** (003-009) if not already applied. Check by looking at the `event_templates` and `waitlist` tables — if they exist, all migrations are done.

2. **Deploy Modal AI pipeline:**
   ```bash
   pip install modal && modal setup
   modal deploy modal/ai_pipeline.py
   ```
   Set `MODAL_API_URL` and `MODAL_ANALYZE_URL` in `.env.local` from the deploy output.

3. **Set up Inngest:**
   - Create account at inngest.com, create app, get keys
   - Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in `.env.local`
   - For local dev: `npx inngest-cli@latest dev`
   - Sync app URL: `https://your-app.vercel.app/api/inngest`
   - Verify 4 functions registered

4. **Verify `.env.local`** has all keys (template at `.env.example`):
   - Supabase: URL, anon key, service role key ← already configured
   - R2: account ID, access key, secret, bucket name, public URL ← already configured
   - Modal: API URL, analyze URL ← from step 2
   - Inngest: event key, signing key ← from step 3
   - Stripe: secret key, publishable key, webhook secret, 6 price IDs ← already configured

5. **End-to-end test:** Create event → upload 15-20 photos → watch Inngest dashboard → verify stacks + sections + event type detection

**Priority 2 — Phase 9 QA (from `tasks/todo.md`):**

Bugs to fix:
- `|| true` debug artifact on event detail section tabs
- Missing error state when event fetch fails
- Suspense boundary around login `useSearchParams()` (Next.js 15 requirement)
- `selection` object in useEffect dependency causing re-renders
- 5 console.log statements to remove from production code
- Unused import (Palette on account page)
- Replace 3 inline SVGs with lucide-react equivalents

Polish:
- Loading skeletons for async server components
- Keyboard navigation in lightbox (arrow keys, Escape)
- Upload zone animation
- Responsive search grid
- Meaningful alt text + aria-labels on icon buttons
- Lightbox dialog semantics + focus trap
- Event detail empty state UX
- Per-page title tags

**Priority 3 — Production deployment:**
- Vercel deployment config
- Domain + CDN setup for R2
- Regenerate `database.types.ts` from live Supabase schema (`npm run db:gen-types`)

**Priority 4 — SPS integration completion:**
- Wire up SPS → Archive import API endpoint
- Wire up Archive → SPS enhancements push
- Test shared auth (same Supabase project)

---

### Key files to know

| Purpose | Path |
|---------|------|
| Project docs | `docs/PRD.md`, `docs/TECHNICAL.md` |
| Setup guide | `docs/SETUP.md` (has actual credentials for Supabase + R2) |
| DB migrations | `supabase/migrations/001-009` |
| AI pipeline | `modal/ai_pipeline.py` |
| Inngest functions | `src/lib/inngest/functions.ts` |
| Inngest route | `src/app/api/inngest/route.ts` |
| Event analysis | `src/lib/ai/event-analysis.ts` |
| Event templates | `src/lib/ai/event-templates.ts` |
| Smart stacks | `src/lib/ai/stacks.ts` |
| Auto sections | `src/lib/ai/sections.ts` |
| Upload completion | `src/app/api/upload/complete/route.ts` |
| Processing status | `src/app/api/events/[eventId]/processing-status/route.ts` |
| Middleware (auth) | `src/middleware.ts` |
| Env template | `.env.example` |
| QA tasks | `tasks/todo.md` |

### Key architectural decisions

- **Shared R2 bucket** between SPS and Pixeltrunk (zero-copy imports)
- **Supabase with pgvector** for semantic search via CLIP embeddings
- **Modal serverless GPU** for AI processing (CLIP + ArcFace + aesthetic scoring)
- **Presigned URL uploads** (client → R2 direct, no server bottleneck)
- **Inngest** for async event-driven processing pipeline
- **CSS columns masonry** (no JS measurement)
- **Stone color palette** from Tailwind (intentionally muted/professional)
- **Libre Baskerville + Inter** typography (professional photography brand)
