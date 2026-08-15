import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { getAuthUser } from "@/lib/auth/helpers";
import { hasIntelAccess } from "@/lib/event-intel/access";

/**
 * "Which optional surfaces should this account be offered?" — nothing more.
 *
 * Client pages cannot read the session synchronously, and defaulting to "no"
 * is what made Ops vanish from six pages when the nav was unified. This answers
 * booleans and leaks nothing: `requireAdmin` returns null for everyone else,
 * every /ops page re-gates server-side, and every Intel route and page re-gates
 * through `hasIntelAccess`.
 *
 * `hasIntel` joined it rather than getting a route of its own so a client page
 * asks ONE question about what it may offer. Two endpoints would be two
 * round-trips and, in time, two answers that disagree.
 *
 * Both flags control what is OFFERED. Neither is the boundary — see
 * `src/lib/event-intel/access.ts`.
 */
export async function GET() {
  const admin = await requireAdmin();
  // Ops follows the REAL session (a power act-as must not lend); Intel follows
  // the EFFECTIVE one (data belonging to the archive you are looking at). See
  // AppNavServer for the full reasoning — and note that means these two flags
  // are answered about two different identities on purpose.
  const { user } = await getAuthUser();
  return NextResponse.json({
    isAdmin: !!admin,
    hasIntel: hasIntelAccess(user?.id),
  });
}
