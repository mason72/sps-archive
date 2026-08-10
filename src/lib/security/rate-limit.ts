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

export async function checkAuthRateLimit(
  supabase: ReturnType<typeof createServiceClient>,
  scope: "password" | "pin" | "search",
  slug: string,
  ip: string
): Promise<boolean> {
  const isSearch = scope === "search";
  const { data, error } = await supabase.rpc("record_auth_attempt", {
    p_key: `${scope}:${slug}:${ip}`,
    p_max: isSearch ? SEARCH_ATTEMPT_MAX : AUTH_ATTEMPT_MAX,
    p_window_seconds: isSearch ? SEARCH_ATTEMPT_WINDOW_SECONDS : AUTH_ATTEMPT_WINDOW_SECONDS,
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
