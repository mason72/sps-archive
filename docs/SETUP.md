# Pixeltrunk — Setup Guide

From code to a working app. The app needs **two services** for the core flow (events, upload, sections, sharing): **Supabase** (metadata DB) and **Cloudflare R2** (file binaries). Stripe (billing) and Resend (email) are needed for paid plans and transactional email. Modal + Inngest power the AI features and are **not required** — the app runs fully without them; AI features stay dormant.

> SECURITY: do not commit real secrets to this file. The values below are placeholders. Keep actual keys in `.env.local` (gitignored). If you previously pasted live keys here, rotate them.

---

## 1. Supabase (metadata database)

### Create project
1. [supabase.com/dashboard](https://supabase.com/dashboard) -> **New Project**, pick a region.
2. Set a database password (store it in your password manager, not here).
3. Wait for provisioning (~2 min).

### Run migrations
In **SQL Editor**, run the files in `supabase/migrations/` in order (001 first). pgvector is enabled by migration 001; if it errors, enable `vector` under **Database -> Extensions** first.

### Get your keys (Settings -> API)
| Key | Env var |
|-----|---------|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| `anon` `public` key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `service_role` key (secret) | `SUPABASE_SERVICE_ROLE_KEY` |

### Auth
Email auth is on by default. For faster local testing, turn off **Authentication -> Settings -> Enable email confirmations** (re-enable for production).

### TypeScript types (optional)
```bash
brew install supabase/tap/supabase     # if needed
export SUPABASE_PROJECT_ID=<your-project-id>   # from dashboard URL
npx supabase login
npm run db:gen-types
```

---

## 2. Cloudflare R2 (file binaries)

### Create bucket
1. [dash.cloudflare.com](https://dash.cloudflare.com) -> **R2 Object Storage** -> **Create bucket**.
2. No public access needed — the app serves files via presigned URLs.

### Create API token
**R2 -> Manage R2 API Tokens -> Create API token**, permission **Object Read & Write**, scoped to your bucket. Save:

| Value | Env var |
|-------|---------|
| Account ID (from dashboard URL) | `R2_ACCOUNT_ID` |
| Access Key ID | `R2_ACCESS_KEY_ID` |
| Secret Access Key | `R2_SECRET_ACCESS_KEY` |

Also set `R2_BUCKET_NAME` and `R2_PUBLIC_URL` (the latter is a fallback only — the app uses presigned URLs).

### Configure bucket CORS (required for large-file uploads)
Uploads use a hybrid transport: files **<= 4 MB** stream through the server proxy (`PUT /api/upload/[imageId]`, no CORS needed), but files **> 4 MB** go **browser -> R2 directly** and **require CORS on the bucket**. The app's R2 API token **cannot** set CORS — you must do it once, manually, in the Cloudflare dashboard (R2 -> your bucket -> Settings -> CORS Policy), allowing `PUT` from your app origin(s).

A `scripts/setup-r2-cors.mjs` helper exists, but bucket-CORS configuration generally must be applied with dashboard/admin credentials, not the scoped app token. Symptom of missing CORS: large uploads fail with `TypeError: Failed to fetch`.

---

## 3. Environment Variables

Create `.env.local` in the project root (see `.env.example` for the full, authoritative list):

```bash
# Supabase (metadata DB)
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Cloudflare R2 (file binaries)
R2_ACCOUNT_ID=<account-id>
R2_ACCESS_KEY_ID=<access-key>
R2_SECRET_ACCESS_KEY=<secret-key>
R2_BUCKET_NAME=<bucket-name>
R2_PUBLIC_URL=https://placeholder.r2.dev

# Stripe (billing) and Resend (email) — see .env.example
# Modal + Inngest — leave unset to keep AI features dormant
```

---

## 4. Run It

```bash
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000).

### Test the core flow
1. **Sign up** at `/signup`.
2. **Create an event** — it is seeded with a "Highlights" section.
3. **Upload photos** (drag & drop). Small files proxy through the server; large files go direct to R2 (needs CORS, step 2).
4. **Organize** — rename/add sections, reorder photos.
5. **Create a share link** via the Share button (set download/favorites/quality, optional password/PIN).
6. **Open the share URL** in an incognito window to see the client gallery.

---

## 5. AI Processing (optional — currently dormant)

These power the (not-yet-active) Smart Stacks, semantic search, face clustering, and aesthetic scoring. Leaving Modal and Inngest unconfigured is the current production state.

### Modal (serverless GPU)
1. Sign up at [modal.com](https://modal.com), create a token: `modal token new`.
2. Deploy the pipeline: `modal deploy modal/ai_pipeline.py`.
3. Set `MODAL_API_URL` (and tokens) in `.env.local`.

> Without Modal: upload, sections, gallery viewing, and sharing all work. Images simply skip AI analysis — no scene tags, aesthetic scores, stacks, or semantic search. Filename search still works.

### Inngest (background job orchestration)
1. Sign up at [inngest.com](https://inngest.com), create an app, get keys.
2. Local dev server: `npx inngest-cli@latest dev`.
3. Set `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`.

> Without Inngest: uploads still save to R2 + Supabase and thumbnails still generate. The AI processing chain just never triggers (`/api/upload/complete` only emits the Inngest event when `INNGEST_EVENT_KEY` is set).

---

## Service Dependency Map

| Feature | Supabase | R2 | Modal | Inngest |
|---------|:--------:|:--:|:-----:|:-------:|
| Auth (login/signup) | req | — | — | — |
| Create events | req | — | — | — |
| Upload photos | req | req | — | — |
| Sections (organize) | req | req | — | — |
| View gallery + lightbox + EXIF | req | req | — | — |
| Share links + client favorites | req | req | — | — |
| Thumbnails | req | req | — | — |
| Filename search | req | req | — | — |
| Semantic search *(dormant)* | req | req | req | — |
| Smart Stacks / aesthetic *(dormant)* | req | req | req | req |
| Face clustering *(dormant)* | req | req | req | req |

**TL;DR — Supabase + R2 give you a fully working archive-and-share app. Modal + Inngest add the (not-yet-active) AI features.**

---

## Troubleshooting

**"Event not found" after creating an event** — confirm all migrations ran; check **Table Editor** for `events`, `images`, `sections`, `section_images`, `shares`, `favorites`.

**Large upload fails with `TypeError: Failed to fetch`** — R2 bucket CORS is not configured (step 2). Small files (<=4 MB) proxy through the server and are unaffected, which is a quick way to confirm CORS is the cause.

**Upload fails with a presigned-URL error** — verify R2 credentials. `R2_ACCOUNT_ID` is the hex string from your Cloudflare dashboard URL.

**Login works but no events show** — RLS is active and events are scoped to `user_id`. Events created before auth was wired won't have a `user_id`.

**"Confirm email" blocking signup** — disable email confirmations in Supabase auth settings for local testing.

**TypeScript errors about database types** — run `npm run db:gen-types` after setting `SUPABASE_PROJECT_ID`.
