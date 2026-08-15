import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { hasIntelAccess, INTEL_DISABLED } from "./access";

/**
 * `getAuthUser()`, plus "and this account has Event Intel".
 *
 * Shaped as a DROP-IN so applying it is a one-word edit in fourteen handlers
 * and cannot be half-applied: it returns the same `{ user, supabase, error }`,
 * so every call site's existing
 *
 *     const { user, supabase, error: authError } = await getIntelUser();
 *     if (authError) return authError;
 *
 * already enforces it. A hand-written `if (!hasIntelAccess(...)) return 403`
 * per handler would have been fourteen chances to forget one — which is
 * precisely how the ownership-filter omission shipped from this repo twice
 * (lessons #2 and #14). Make the safe thing the thing you were already typing.
 *
 * ⚠️ This gates the FEATURE. It does not scope the DATA. Every query behind it
 * still needs its `.eq("user_id", …)`, because `getAuthUser()` hands back the
 * service client and RLS is bypassed. Two independent protections; neither
 * substitutes for the other.
 *
 * Lives apart from `access.ts` on purpose: this file reaches `next/headers`
 * through `getAuthUser`, so it can never be imported by a client component,
 * while `hasIntelAccess` stays pure and importable anywhere.
 */
export async function getIntelUser() {
  const auth = await getAuthUser();
  if (auth.error) return auth;
  if (!hasIntelAccess(auth.user?.id)) {
    return {
      ...auth,
      error: NextResponse.json(INTEL_DISABLED, { status: 403 }),
    };
  }
  return auth;
}
