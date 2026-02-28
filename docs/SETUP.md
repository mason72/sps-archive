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

## 5. AI Processing (Phase 2 — add when ready)

This powers smart stacks, semantic search, aesthetic scoring, and face clustering.

### Modal (serverless GPU)
1. Sign up at [modal.com](https://modal.com)
2. Create a token: `modal token new`
3. Deploy the processing function (we need to build this — it's the Modal app that runs CLIP + ArcFace)

```bash
MODAL_API_URL=https://your-modal-app--process-image.modal.run
```

> **Without Modal:** Upload and gallery viewing work fine. Images just skip the AI analysis step — no aesthetic scores, scene tags, or semantic search. Filename search still works.

### Inngest (background job orchestration)
1. Sign up at [inngest.com](https://inngest.com)
2. Create an app → get your keys
3. For local dev, run the Inngest dev server:

```bash
npx inngest-cli@latest dev
```

```bash
INNGEST_EVENT_KEY=your-event-key
INNGEST_SIGNING_KEY=your-signing-key
```

> **Without Inngest:** Uploads still save to R2 and create DB records. The background processing pipeline (thumbnails → AI analysis → stacking) just won't trigger. You'll see images in "processing" status.

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

**TL;DR — Supabase + R2 gets you a fully working app. Modal + Inngest add the AI magic.**

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
