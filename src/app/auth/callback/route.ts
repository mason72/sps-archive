import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * GET /auth/callback
 *
 * Supabase auth callback — exchanges an auth code from email links
 * (password reset, magic link, email verification) for a session.
 * Redirects to `next` query param or "/" on success.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const type = searchParams.get("type");
  // Recovery flows always go to /reset-password regardless of `next`.
  // `next` must be a same-origin path: "https://evil.com" or "//evil.com"
  // would bounce a freshly-authenticated user off-site (open redirect).
  const rawNext = searchParams.get("next") || "/";
  const safeNext = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const next = type === "recovery" ? "/reset-password" : safeNext;

  if (code) {
    const response = NextResponse.redirect(new URL(next, origin));

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return response;
    }
  }

  // If no code or exchange failed, redirect to login with error
  return NextResponse.redirect(
    new URL("/login?error=auth_callback_failed", request.url)
  );
}
