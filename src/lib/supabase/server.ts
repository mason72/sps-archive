import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "./database.types";

/** 400 days in seconds — max persistent cookie lifetime per RFC 6265bis */
const PERSISTENT_MAX_AGE = 60 * 60 * 24 * 400;

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  // Read "remember me" preference — defaults to persistent sessions
  const rememberCookie = cookieStore.get("pt-remember-me");
  const remember = rememberCookie?.value !== "0";

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
  );
}

/** Service-role client for server-side operations that bypass RLS */
export function createServiceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
