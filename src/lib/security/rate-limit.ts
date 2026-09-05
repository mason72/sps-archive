import type { NextRequest } from "next/server";
import type { createServiceClient } from "@/lib/supabase/server";

/**
 * Fixed-window rate limiting for public credential checks (gallery passwords,
 * download PINs), backed by the auth_attempts table + record_auth_attempt()
 * (migration 026). One atomic RPC per check.
 *
 * Fails OPEN on infrastructure errors — a broken limiter must not lock every
 * client out of their galleries — but logs loudly so it's not silent.
 */

/** 5 attempts per 15 minutes per (scope, slug, ip). */
export const AUTH_ATTEMPT_MAX = 5;
export const AUTH_ATTEMPT_WINDOW_SECONDS = 15 * 60;

/**
 * Guest search counts every REQUEST (not failures — there's no reset), so its
 * budget is generous: enough for an enthusiastic guest, a wall for a scraper.
 */
export const SEARCH_ATTEMPT_MAX = 120;
export const SEARCH_ATTEMPT_WINDOW_SECONDS = 10 * 60;

/**
 * Guest share-link minting also counts every request. A coordinator sharing a
 * headshot day person-by-person is the legitimate heavy user (dozens of
 * mints); a spammer scripting rows is the wall's job. Dedupe upstream makes
 * re-mints free, so this budget is about DISTINCT sets per IP.
 */
export const GUEST_SHARE_MAX = 30;
export const GUEST_SHARE_WINDOW_SECONDS = 15 * 60;

/**
 * Single-image presigns (`image-download`) count every AUTHORIZED request.
 * Without this the route was an unbounded presign minter for anyone past the
 * PIN. The budget is the human ceiling, not the gallery size: one click every
 * two seconds for the whole window is 300, and thirty guests behind one venue
 * NAT saving ten photos each is 300. Measured 2026-09-05: the largest curated
 * share is 50 images and the median event 396, so a guest hand-saving a whole
 * gallery this way is already slower than the bulk ZIP built for that; a
 * script pulling thousands is the wall's job.
 */
export const IMAGE_DOWNLOAD_MAX = 300;
export const IMAGE_DOWNLOAD_WINDOW_SECONDS = 10 * 60;

export type RateLimitScope =
  | "password"
  | "pin"
  | "search"
  | "forgot"
  | "waitlist"
  | "guest-list"
  | "guest-share"
  | "image-download";

const DEFAULT_BUDGET = { max: AUTH_ATTEMPT_MAX, windowSeconds: AUTH_ATTEMPT_WINDOW_SECONDS };

/** Per-scope budget; anything not listed is a credential check (5 / 15 min). */
const BUDGETS: Partial<Record<RateLimitScope, { max: number; windowSeconds: number }>> = {
  search: { max: SEARCH_ATTEMPT_MAX, windowSeconds: SEARCH_ATTEMPT_WINDOW_SECONDS },
  "guest-share": { max: GUEST_SHARE_MAX, windowSeconds: GUEST_SHARE_WINDOW_SECONDS },
  "image-download": { max: IMAGE_DOWNLOAD_MAX, windowSeconds: IMAGE_DOWNLOAD_WINDOW_SECONDS },
};

export function rateLimitBudget(scope: RateLimitScope) {
  return BUDGETS[scope] ?? DEFAULT_BUDGET;
}

export async function checkAuthRateLimit(
  supabase: ReturnType<typeof createServiceClient>,
  scope: RateLimitScope,
  slug: string,
  ip: string
): Promise<boolean> {
  const budget = rateLimitBudget(scope);
  const { data, error } = await supabase.rpc("record_auth_attempt", {
    p_key: `${scope}:${slug}:${ip}`,
    p_max: budget.max,
    p_window_seconds: budget.windowSeconds,
  });
  if (error) {
    console.error("Rate limit check failed (failing open):", error.message);
    return true;
  }
  return data === true;
}

/**
 * Clear the counter after a successful check so the window only ever counts
 * failures — a legit guest re-entering the PIN a few times per visit never
 * bumps into the limit.
 */
export async function resetAuthRateLimit(
  supabase: ReturnType<typeof createServiceClient>,
  scope: "password" | "pin",
  slug: string,
  ip: string
): Promise<void> {
  await supabase
    .from("auth_attempts")
    .delete()
    .eq("key", `${scope}:${slug}:${ip}`);
}

/** Client IP as Vercel reports it (first x-forwarded-for hop). */
export function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  );
}
