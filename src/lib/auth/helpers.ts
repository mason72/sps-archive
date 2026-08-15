import {
  createServerSupabaseClient,
  createServiceClient,
} from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { ACT_AS_COOKIE, decodeActAs } from "./impersonation";

type TypedSupabaseClient = ReturnType<typeof createServiceClient>;

interface AuthResult {
  /** The EFFECTIVE user — the identity content queries scope to. */
  user: User | null;
  supabase: TypedSupabaseClient;
  error: NextResponse | null;
  /** The session's actual account. Differs from `user` only under act-as.
   *  Anything ADMIN-gated (requireAdmin, ops) must check THIS one. */
  realUser: User | null;
  /** True when an admin is acting as another account. */
  actingAs: boolean;
}

/**
 * Get the authenticated user and a typed Supabase client.
 * Returns a 401 error response if not authenticated.
 *
 * Auth verification uses the cookie-based SSR client.
 * Database queries use the service client for full type safety.
 * Route-level RLS is enforced by middleware + explicit user_id filters.
 *
 * Usage in API routes:
 * ```
 * const { user, supabase, error } = await getAuthUser();
 * if (error) return error;
 * // user is guaranteed non-null here
 * ```
 */
export async function getAuthUser(): Promise<AuthResult> {
  const authClient = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await authClient.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase: createServiceClient(),
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      realUser: null,
      actingAs: false,
    };
  }

  const supabase = createServiceClient();

  // ─── Act-as: an ADMIN session may assume another account's identity for
  // content work (signed cookie; see impersonation.ts). The is_admin check
  // runs on the REAL session every request, so the cookie grants nothing on
  // its own. On any failure we fall through to the real identity — acting
  // never widens access, it only re-points ownership scoping.
  const jar = await cookies();
  const target = decodeActAs(jar.get(ACT_AS_COOKIE)?.value);
  if (target && target.uid !== user.id) {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("is_admin")
      .eq("user_id", user.id)
      .single();
    if (profile?.is_admin) {
      const effective = {
        ...user,
        id: target.uid,
        email: target.email,
      } as User;
      return { user: effective, supabase, error: null, realUser: user, actingAs: true };
    }
  }

  return { user, supabase, error: null, realUser: user, actingAs: false };
}

/**
 * The signed-in user's id, or null — WITHOUT producing a 401.
 *
 * For public routes that must behave differently for the owner but must still
 * answer everyone. `getAuthUser()` cannot do this: it returns a 401 response
 * for an anonymous caller, which is correct for an owner-only route and fatal
 * for a guest gallery.
 *
 * The case it exists for: the photographer opening their own live gallery.
 * Gallery status treats a VIEW as delivery evidence — 6 of 15 live galleries
 * were known to be opened with no email ever having left Pixeltrunk — so
 * counting the owner's own visit would mark an unopened gallery as seen by the
 * client. That is a lie about the one signal that says whether the work landed.
 *
 * Deliberately the REAL session, not the act-as identity: an admin checking
 * someone's gallery while acting as them is still not that client viewing it.
 */
export async function getOptionalUserId(): Promise<string | null> {
  try {
    const authClient = await createServerSupabaseClient();
    const { data, error } = await authClient.auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    // A guest with no cookie at all must never fail the page.
    return null;
  }
}
