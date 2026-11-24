/**
 * The Scout integration's gate: a shared secret in `X-Scout-Key`, compared in
 * constant time against `SCOUT_INTEGRATION_KEY`.
 *
 * Two different failures, two different codes, because they have two different
 * fixes:
 *  - 503: THIS server has no key configured. Nothing Scout sends can fix it,
 *    and it must never read as "open" (a missing env var is an outage, not a
 *    pass; ship-discipline 6c).
 *  - 401: the key is missing or wrong. Scout's config is the thing to look at.
 *
 * The proxy lists /api/integrations/scout/ as public (no session), so this
 * check is the ONLY thing standing in front of those routes. Every handler
 * calls `requireScoutKey` first.
 */
import { NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/shares/hash";

export const SCOUT_KEY_HEADER = "x-scout-key";

export type ScoutKeyVerdict =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/** Pure: the decision, given the header value and the configured key. */
export function checkScoutKey(
  presented: string | null | undefined,
  configured: string | null | undefined
): ScoutKeyVerdict {
  if (!configured) {
    return {
      ok: false,
      status: 503,
      error: "Scout integration is not configured on this server (SCOUT_INTEGRATION_KEY is unset).",
    };
  }
  if (!presented) {
    return { ok: false, status: 401, error: "Missing X-Scout-Key header." };
  }
  if (!timingSafeEqualStr(presented, configured)) {
    return { ok: false, status: 401, error: "Invalid X-Scout-Key." };
  }
  return { ok: true };
}

/** Route helper: a response to return when the request is refused, else null. */
export function requireScoutKey(request: Request): NextResponse | null {
  const verdict = checkScoutKey(
    request.headers.get(SCOUT_KEY_HEADER),
    process.env.SCOUT_INTEGRATION_KEY
  );
  if (verdict.ok) return null;
  return NextResponse.json({ error: verdict.error }, { status: verdict.status });
}
