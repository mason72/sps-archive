# Pixeltrunk — Setup Guide

Everything you need to go from code to working app.

---

## Quick Start (minimum to test core flow)

You need **2 services** to test event creation, upload, and gallery sharing:

1. **Supabase** — Database + Auth
2. **Cloudflare R2** — Image storage

AI features (smart stacks, semantic search, face clustering) need Modal + Inngest and can be added later.

---

## 1. Supabase

### Create project
1. Go to [supabase.com/dashboard](https://supabase.com/dashboard)
2. **New Project** → pick a name (e.g. `sps-prism`) and region
3. Set a database password (save it somewhere)
4. Wait for provisioning (~2 min)

### Run migrations
1. Go to **SQL Editor** in the Supabase dashboard
2. Paste the contents of `supabase/migrations/001_initial_schema.sql` → **Run**
3. Paste the contents of `supabase/migrations/002_rls_policies.sql` → **Run**

> **Note:** The vector extension (`pgvector`) is included in migration 001. If you get an error about it, go to **Database → Extensions** and enable `vector` first.

### Get your keys
Go to **Settings → API**:

| Key | Env var |
|-----|---------|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | https://hfusdrtrizabzzcdhnyy.supabase.co
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmdXNkcnRyaXphYnp6Y2Robnl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMDM0MDMsImV4cCI6MjA4Nzc3OTQwM30._LnplUHBZcPniS5Ea8w9svl6xP_25xCck0vSjheLZPk
| `service_role` key (hidden by default) | `SUPABASE_SERVICE_ROLE_KEY` | eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhmdXNkcnRyaXphYnp6Y2Robnl5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIwMzQwMywiZXhwIjoyMDg3Nzc5NDAzfQ.juRjt2p5C2qpNUHQVsXXB_qMXVl6VXIsA-JLFsr2g_o

Direct Connection String | postgresql://postgres:AYcJajOSjzg1neMu@db.hfusdrtrizabzzcdhnyy.supabase.co:5432/postgres

### Enable Auth
1. Go to **Authentication → Providers**
2. **Email** should already be enabled (it's the default)
3. Optional: Turn off "Confirm email" under **Authentication → Settings** for faster testing (you can re-enable later)

### Generate TypeScript types (optional but recommended)
```bash
# Install Supabase CLI if you haven't
brew install supabase/tap/supabase

# Get your project ID from the dashboard URL: supabase.com/dashboard/project/<PROJECT_ID>
export SUPABASE_PROJECT_ID=your-project-id

SUPABASE_PROJECT_ID: hfusdrtrizabzzcdhnyy

# Login and generate types
npx supabase login
npm run db:gen-types
```

---

## 2. Cloudflare R2

### Create bucket
1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2 Object Storage**
2. **Create bucket** → name it `sps-prism`
3. Leave defaults (no public access needed — we use presigned URLs)

### Create API token
1. Go to **R2 → Manage R2 API Tokens** → **Create API token**
2. Permissions: **Object Read & Write**
3. Scope to the `sps-prism` bucket
4. Save the credentials:

| Value | Env var |
|-------|---------|
| Account ID (from the dashboard URL) | `R2_ACCOUNT_ID` | aa3ce5fa7edd5346e777d23a4c34fe17
| Access Key ID | `R2_ACCESS_KEY_ID` | e7a52d3915dcc09cd659789e8f1b0aca
| Secret Access Key | `R2_SECRET_ACCESS_KEY` | 0ee838ee2bd835619903a42dbc6fafda077049d4ff207c29b96ed54c5f9738e2

Set these as well:
```
R2_BUCKET_NAME=sps-prism
R2_PUBLIC_URL=https://your-account-id.r2.cloudflarestorage.com/sps-prism
```

> **R2_PUBLIC_URL** is only used as a fallback — the app primarily uses presigned download URLs. You can set this to any placeholder for now.

---

## 3. Environment Variables

Create `.env.local` in the project root:

```bash
# ── Supabase ──
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# ── Cloudflare R2 ──
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=sps-prism
R2_PUBLIC_URL=https://placeholder.r2.dev
```

---

## 4. Run It

```bash
npm install
npm run dev
```

Then open [localhost:3000](http://localhost:3000).

### Test the core flow:
1. **Sign up** at `/signup` → creates your account
2. **Create an event** from the homepage
3. **Upload photos** on the event page (drag & drop)
4. **Open lightbox** by clicking any image
5. **Create a share link** via the "Share" button
6. **Open the share URL** in an incognito window to see the client gallery

---

## 5. AI Processing — Modal + Inngest

This powers smart stacks, semantic search, aesthetic scoring, face clustering, and **AI event type detection**.

### 5a. Modal (serverless GPU)

Modal runs CLIP, ArcFace, and aesthetic scoring on a T4 GPU.

1. **Install Modal CLI:**
   ```bash
   pip install modal
   modal setup  # Opens browser to authenticate
   ```
2. **Create a Modal token:**
   ```bash
   modal token new
   ```
3. **Deploy the AI pipeline:**
   ```bash
   modal deploy modal/ai_pipeline.py
   ```
4. **Copy the endpoint URLs** from the deploy output:
   ```
   ├── process_image        => https://you--pixeltrunk-ai-process-image.modal.run
   ├── embed_text           => https://you--pixeltrunk-ai-embed-text.modal.run
   └── analyze_event_sample => https://you--pixeltrunk-ai-analyze-event-sample.modal.run
   ```
5. **Set env vars:**
   ```bash
   MODAL_API_URL=https://you--pixeltrunk-ai-process-image.modal.run
   MODAL_ANALYZE_URL=https://you--pixeltrunk-ai-analyze-event-sample.modal.run
   ```

**Test it:**
```bash
curl -X POST https://your-modal-url--embed-text.modal.run \
  -H "Content-Type: application/json" \
  -d '{"text": "wedding ceremony"}'
# Should return a 768-dim embedding array
```

> **Without Modal:** Upload and gallery viewing work fine. Images skip AI analysis — no aesthetic scores, scene tags, or semantic search. Filename search still works.

### 5b. Inngest (event orchestration)

Inngest orchestrates the multi-step pipeline: upload → thumbnails → AI → stacks → event analysis.

1. **Sign up** at [inngest.com](https://inngest.com) → Create an app
2. **Get your keys** from app settings:
   ```bash
   INNGEST_EVENT_KEY=your-event-key
   INNGEST_SIGNING_KEY=your-signing-key
   ```
3. **For local dev**, run the Inngest dev server:
   ```bash
   npx inngest-cli@latest dev
   ```
   This starts at `http://localhost:8288` and auto-discovers your functions.

4. **For production**, sync your app:
   - Inngest dashboard → Apps → Sync New App
   - Enter: `https://your-app.vercel.app/api/inngest`

5. **Verify 4 functions are registered:**
   - `process-uploaded-image` — per-image AI processing
   - `build-event-stacks` — face + burst stacks, auto sections
   - `process-imported-event` — SPS import fan-out
   - `analyze-event` — AI event type detection + template matching

> **Without Inngest:** Uploads save to R2 and create DB records, but the background pipeline won't trigger. Images stay in "pending" status.

### 5c. Run migrations 003-009

If you only ran migrations 001-002 earlier, run the rest now:
```
supabase/migrations/003_thumbnail_column.sql
supabase/migrations/004_user_profiles.sql
supabase/migrations/005_email_templates.sql
supabase/migrations/006_share_image_ids.sql
supabase/migrations/007_download_pin.sql
supabase/migrations/008_event_templates.sql
supabase/migrations/009_waitlist.sql
```

### 5d. End-to-End AI Test

1. Start the app with all env vars set
2. Create an event and upload 15-20 photos from a real shoot (with EXIF)
3. Watch the Inngest dashboard:
   - `process-uploaded-image` fires per image (~5s each after GPU warmup)
   - When all complete → `build-event-stacks` fires
   - Then → `analyze-event` fires
4. Check the event page:
   - Auto sections created from scene tags
   - Smart stacks group similar/burst images
   - Event type auto-detected (check via `GET /api/events/{id}/analyze`)
5. Check processing status:
   - `GET /api/events/{id}/processing-status`
   - `stage` field: `processing` → `analyzing` → `ready`

---

## Service Dependency Map

| Feature | Supabase | R2 | Modal | Inngest |
|---------|:--------:|:--:|:-----:|:-------:|
| Auth (login/signup) | **required** | — | — | — |
| Create events | **required** | — | — | — |
| Upload photos | **required** | **required** | — | — |
| View photos in gallery | **required** | **required** | — | — |
| Lightbox + EXIF | **required** | **required** | — | — |
| Share links | **required** | **required** | — | — |
| Client favorites | **required** | **required** | — | — |
| Filename search | **required** | **required** | — | — |
| Semantic search ("first dance") | **required** | **required** | **required** | — |
| Aesthetic scores + smart stacks | **required** | **required** | **required** | **required** |
| Face clustering | **required** | **required** | **required** | **required** |
| Thumbnail generation | **required** | **required** | — | **required** |
| AI event type detection | **required** | **required** | **required** | **required** |
| Auto sections (scene-based) | **required** | **required** | **required** | **required** |
| Event template matching | **required** | — | — | **required** |
| Multi-event splitting | **required** | **required** | **required** | **required** |
| Waitlist signups | **required** | — | — | — |

**TL;DR — Supabase + R2 gets you a fully working app. Modal + Inngest add the AI magic.**

---

## AI Pipeline Flow

```
User uploads photos
       │
       ▼
POST /api/upload → creates image records, returns presigned R2 URLs
       │
       ▼
Client uploads directly to R2
       │
       ▼
POST /api/upload/complete → saves EXIF, fires Inngest "image/uploaded"
       │
       ▼
┌──────────────────────────────────────────────────┐
│  Inngest: processUploadedImage (per image)       │
│  1. Generate thumbnails (3 sizes via sharp)      │
│  2. Call Modal AI (CLIP + ArcFace + aesthetic)   │
│  3. Save results to Supabase                     │
│  4. Check: all images done? → fire next event    │
└──────────────────────────────────────────────────┘
       │ when all images complete
       ▼
┌──────────────────────────────────────────────────┐
│  Inngest: buildEventStacks                       │
│  1. Build face stacks (group by person)          │
│  2. Build burst stacks (sequential photos)       │
│  3. Generate auto sections (scene-based)         │
│  4. Trigger event analysis                       │
└──────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│  Inngest: analyzeEvent                           │
│  1. Analyze scene tag distribution               │
│  2. Detect event type (wedding/corp/headshot)    │
│  3. Match to event template                      │
│  4. Auto-apply type + template sections          │
│  5. Notify analysis complete                     │
└──────────────────────────────────────────────────┘
       │
       ▼
Event is fully organized and ready to share
```

---

## Troubleshooting

**"Event not found" after creating an event**
→ Check that both migrations ran successfully. Look at **Table Editor** in Supabase — you should see `events`, `images`, `shares`, `favorites`, and other tables.

**Upload fails with presigned URL error**
→ Verify R2 credentials. The `R2_ACCOUNT_ID` is the hex string from your Cloudflare dashboard URL, not your email.

**Login works but can't see events**
→ RLS is active. Make sure migration 002 ran (adds `user_id` to events). Events created before auth was set up won't have a `user_id` and will be invisible.

**"Confirm email" blocking signup**
→ In Supabase dashboard: **Authentication → Settings → turn off "Enable email confirmations"** for local testing.

**TypeScript errors about database types**
→ Run `npm run db:gen-types` after setting `SUPABASE_PROJECT_ID`. This regenerates types from your live schema.

**Images stuck in "pending" status**
→ Inngest is not receiving events. Check that `INNGEST_EVENT_KEY` is set. For local dev, run `npx inngest-cli@latest dev` and verify your functions appear at `http://localhost:8288`.

**Modal timeout on first image**
→ T4 GPU containers cold-start in ~60s. First image is slow, subsequent ones take ~5s. This is normal.

**No stacks created after processing**
→ Face stacks need 2+ images of the same person. Burst stacks need 3+ sequential images within 2 seconds. Upload more photos or check that Modal is returning face embeddings.

**No auto sections created**
→ Sections need 3+ images with the same scene tag. Check that Modal is returning `scene_tags` in processing results. Upload at least 15-20 photos for reliable section detection.

**Event type shows "general"**
→ Not enough scene diversity to detect a specific type. Wedding detection needs 2+ wedding-specific tags (ceremony, reception, first-dance, etc.). Upload at least 20 photos from a real event.

**`analyze-event` not firing**
→ Check that the Inngest dashboard shows 4 functions (not 3). If `analyze-event` is missing, redeploy — the function was recently added to the route handler.

**Processing status shows "analyzing" indefinitely**
→ The `analyze-event` Inngest function may have failed. Check the Inngest dashboard for error details. Common cause: no images with `processing_status = 'complete'`.
