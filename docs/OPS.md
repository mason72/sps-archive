# Pixeltrunk Ops — alpha access, metering, and cost automation

Built 2026-08-10. Everything here shipped verified; history in `tasks/todo.md`
("Alpha access + ops.pixeltrunk.com" and the feedback rounds).

## Access model

- **Signup is invitation-only.** Public Supabase signups are DISABLED at the
  project level (sps-prism dashboard toggle); the ONLY door is
  `/api/auth/signup` (`admin.createUser`), and its lock is the
  **`allowed_signups`** table (migration 037). Fail-closed: no row → 403.
- **Waitlist**: pixeltrunk.com's "Request an invite" form → `POST /api/waitlist`
  (public; honeypot `company` field, per-IP rate limit scope `waitlist`,
  never reveals whether an email is known) → `waitlist` table (043) → admin
  notification email → reviewed on /ops (approve = whitelist + branded
  invite; dismiss keeps the row).
- **Invite email has ONE home**: `src/lib/emails/invite.ts` — used by the /ops
  panels and `scripts/send-invite.ts <email>` (CLI; signup link pinned to prod).
- **Admin** = `user_profiles.is_admin`, held ONLY by mason@twodudesphoto.com
  (personal). info@twodudesphoto.com is the shared TEAM login and must never
  be admin — the team is not supposed to see /ops.
- **Act-as** (`src/lib/auth/impersonation.ts`): admins assume another account
  via signed httpOnly cookie ("work as" on /ops). `getAuthUser()` returns
  `{user: effective, realUser, actingAs}`; **anything admin-gated checks
  `realUser`** (requireAdmin), content scopes to `user`. Demotion kills the
  cookie instantly. Full-width emerald top bar while acting. Known wart:
  client-side RLS reads (Cmd-K palette) can't be impersonated.

## Ops dashboard — app.pixeltrunk.com/ops (= ops.pixeltrunk.com)

- Gate: `requireAdmin()` (`src/lib/auth/admin.ts`) is the ONE is_admin check;
  `assertAdminPage()` is awaited at the top of every /ops PAGE **before any
  fetch** — a layout gate is NOT a security boundary (streaming SSR renders
  page+layout in parallel; lesson 51b). Middleware auths the ops host before
  rewriting. Verify access control with raw curl, never a browser.
- Panels: stat row, 30-day cost sparkline, cost-by-account (with "work as"),
  alpha invites, waitlist review, fixed-overhead estimates, metered activity,
  error triage (user-attributed via system_errors.user_id).

## Metering (docs also in memory: usage-metering-architecture)

- **Flows** → `usage_events` (040): Modal wall-time (ai_index/embed_text/
  selfie/video), zip bytes, cover rasters, email sends. Guest-triggered work
  bills the EVENT OWNER. `recordUsage()` is ALWAYS awaited (a void insert at
  an Inngest step boundary loses the row) and never throws.
- **Stock** → `get_user_storage(uuid)` SQL (one home) wrapped by
  `src/lib/usage/storage.ts`; `images.thumb_bytes` written at all 7
  thumbnail sites; pre-metering rows estimated (videos excluded).
- **Prices live ONLY in `src/lib/usage/costs.ts`** (real Modal/R2/Resend
  rates; R2 egress is free; `PLATFORM_OVERHEAD_MONTHLY` are estimates).
  `getUsageOverview()` (`usage/summary.ts`) is the one compute home shared by
  /ops and the weekly email — they cannot disagree.

## Automation (src/lib/inngest/ops-functions.ts)

- `usage-anomaly-daily` (8:07am PT + `ops/anomaly.run`): flags yesterday >
  multiplier × max(user 7-day avg, baseline). Knobs in `ops_config` key
  "anomaly" (042); baseline seeded $1/day — recalibrate from measured TDP
  usage after ~a week. All flags in ONE reportSystemError.
- `pricing-summary-weekly` (Mon 8:11am PT + `ops/pricing-summary.run`):
  shadow invoice to ADMIN_ALERT_EMAIL; tier fit + margin from
  `PLANS.monthlyPriceUsd` (stripe/config.ts — must match m/pricing page).
- First-run harness: `scripts/verify-ops-crons.ts` (pass ADMIN_ALERT_EMAIL).
- Verifying Inngest registration: unsigned GET /api/inngest is 401 since SDK
  3.54 — introspection must be HMAC-signed (the 401 is itself healthy).

## Marketing site (src/app/m)

Copy posture: **outcome-led, mechanism-silent** — no model names, no infra
nouns, no roadmap. Trial claims are gone; CTAs point at the waitlist form
(`#invite`). Pricing stays public; FAQ says the alpha is free.

## QA patterns that work here

- Throwaway admin: create via admin API + is_admin, drive the UI, demote live
  to prove fail-closed, delete after. `.env.local` is PRODUCTION — scratch
  events only, delete when done.
- Synthetic uploads: build Files in-page (canvas → DataTransfer) and set them
  on the file INPUT + dispatch `change` (synthetic drag/drop events don't
  trigger the dropzone). Noise images (~200KB) slow the pipeline enough to
  observe in-flight states.
