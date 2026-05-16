import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/**
 * Structural type for the Supabase client used throughout the app. Both the
 * cookie-bound (RLS-enforced) client and the service-role client satisfy it.
 *
 * Defined with a single generic so supabase-js v2.97's type defaults pick up
 * `Database["public"]` correctly. (Passing the explicit schema parameter
 * trips a generic-signature mismatch between @supabase/ssr 0.5 and the
 * v2.97 SupabaseClient class.)
 */
export type AppSupabaseClient = SupabaseClient<Database>;

/** 400 days in seconds — max persistent cookie lifetime per RFC 6265bis */
const PERSISTENT_MAX_AGE = 60 * 60 * 24 * 400;

export async function createServerSupabaseClient(): Promise<AppSupabaseClient> {
  const cookieStore = await cookies();

  // Read "remember me" preference — defaults to persistent sessions
  const rememberCookie = cookieStore.get("pt-remember-me");
  const remember = rememberCookie?.value !== "0";

  // Cast: @supabase/ssr 0.5 declares its return type against an older
  // SupabaseClient signature than v2.97 ships. Both shapes are runtime
  // identical; this aligns the static type.
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                ...(remember ? { maxAge: PERSISTENT_MAX_AGE } : {}),
              })
            );
          } catch {
            // Server component — can't set cookies, but that's fine for reads
          }
        },
      },
    }
  ) as unknown as AppSupabaseClient;
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * ⚠️ Use sparingly — only for: Stripe webhooks, Inngest workers, internal
 * admin helpers, Supabase Auth admin calls, public-facing share/gallery
 * resolution. Anything that acts on behalf of an authenticated user should
 * use the cookie-bound client returned by `getAuthUser()` so RLS protects us
 * when developers forget to add user_id filters.
 */
export function createServiceClient(): AppSupabaseClient {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
