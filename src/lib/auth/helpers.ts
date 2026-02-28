import {
  createServerSupabaseClient,
  createServiceClient,
} from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";

type TypedSupabaseClient = ReturnType<typeof createServiceClient>;

interface AuthResult {
  user: User | null;
  supabase: TypedSupabaseClient;
  error: NextResponse | null;
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
    };
  }

  return { user, supabase: createServiceClient(), error: null };
}
