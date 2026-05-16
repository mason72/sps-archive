import {
  createServerSupabaseClient,
  type AppSupabaseClient,
} from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

interface AuthResult {
  user: User | null;
  supabase: AppSupabaseClient;
  error: NextResponse | null;
}

/**
 * Resolve the authenticated user and return a **cookie-bound** Supabase client.
 *
 * The returned client uses the user's session cookies and is subject to RLS.
 * RLS policies on user-owned tables (events, images, stacks, sections, …)
 * scope every query to `auth.uid() = user_id` automatically, so a route that
 * forgets an explicit `.eq("user_id", user.id)` filter cannot leak another
 * user's data — it will just return zero rows / a 404.
 *
 * Routes that genuinely need to bypass RLS (Stripe webhook, public gallery
 * resolution, Inngest workers, admin helpers, Supabase Auth admin calls)
 * should import `createServiceClient` directly and document why.
 *
 * Usage:
 * ```ts
 * const { user, supabase, error } = await getAuthUser();
 * if (error) return error;
 * // user is guaranteed non-null here; supabase is RLS-enforced
 * ```
 */
export async function getAuthUser(): Promise<AuthResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      user: null,
      supabase,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { user, supabase, error: null };
}
