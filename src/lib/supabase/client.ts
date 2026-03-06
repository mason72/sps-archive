import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

const REMEMBER_KEY = "pt-remember-me";

/** Store the user's "remember me" preference (called at login) */
export function setRememberPreference(remember: boolean) {
  if (typeof window !== "undefined") {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  }
}

/** Read stored preference — defaults to true (stay logged in) */
export function getRememberPreference(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(REMEMBER_KEY) !== "0";
}

/**
 * Create a browser-side Supabase client.
 *
 * When "remember me" is active (default), auth cookies persist for 400 days
 * (the maximum browsers allow). When off, cookies are session-only and
 * clear when the browser closes.
 */
export function createClient() {
  const remember = getRememberPreference();

  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        path: "/",
        sameSite: "lax" as const,
        secure: process.env.NODE_ENV === "production",
        // 400 days — max persistent cookie lifetime per RFC 6265bis
        // Omit maxAge entirely for session-only cookies
        ...(remember ? { maxAge: 60 * 60 * 24 * 400 } : {}),
      },
    }
  );
}
