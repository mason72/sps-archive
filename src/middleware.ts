import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** 400 days in seconds — max persistent cookie lifetime per RFC 6265bis */
const PERSISTENT_MAX_AGE = 60 * 60 * 24 * 400;

/**
 * Middleware — Subdomain routing + Route protection + Supabase session management.
 *
 * Domain routing:
 *   pixeltrunk.com (marketing domain) → rewrites to /m/... routes
 *   app.pixeltrunk.com (app domain)   → serves app routes directly
 *   localhost:3002 (dev)              → serves app routes (visit /m for marketing in dev)
 *
 * Public app routes (no auth required):
 *   /, /login, /signup, /forgot-password, /reset-password,
 *   /auth/callback, /gallery/*, /api/gallery/*, /api/inngest, /api/stripe/webhook, /api/sps/*, /api/site/*
 *
 * Protected app routes (redirect to /login if unauthenticated):
 *   /events/*, /api/events/*, /api/upload/*, /api/search/*,
 *   /api/images/*, /api/stacks/*, /api/shares/*, /api/account/*
 */
export async function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const { pathname } = request.nextUrl;

  // ─── Marketing domain detection ───
  // pixeltrunk.com or www.pixeltrunk.com → rewrite to /m/... (marketing routes)
  const isMarketingDomain =
    hostname === "pixeltrunk.com" ||
    hostname === "www.pixeltrunk.com";

  if (isMarketingDomain) {
    // Let API routes pass through on marketing domain (Inngest, Stripe webhooks, etc.)
    if (pathname.startsWith("/api/")) {
      return NextResponse.next({ request });
    }
    // Marketing routes are all public — no auth needed
    // Rewrite / → /m, /pricing → /m/pricing, etc.
    const marketingPath = pathname === "/" ? "/m" : `/m${pathname}`;
    const url = request.nextUrl.clone();
    url.pathname = marketingPath;
    return NextResponse.rewrite(url);
  }

  // ─── /m routes accessible directly in dev (localhost:3002/m/...) ───
  if (pathname.startsWith("/m")) {
    // Allow direct access to marketing routes (for dev + internal linking)
    return NextResponse.next({ request });
  }

  // ─── App domain: Supabase auth + route protection ───
  let supabaseResponse = NextResponse.next({ request });

  // Read "remember me" preference — defaults to persistent sessions
  const rememberCookie = request.cookies.get("pt-remember-me");
  const remember = rememberCookie?.value !== "0";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              // Override maxAge based on remember-me preference
              ...(remember ? { maxAge: PERSISTENT_MAX_AGE } : {}),
            })
          );
        },
      },
    }
  );

  // Validate session with Supabase auth server
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ─── Ops domain: ops.pixeltrunk.com → /ops/... ───
  // Placed AFTER the session check on purpose: an early-return rewrite would
  // skip auth, and with streaming SSR the ops page's data renders in parallel
  // with its layout — a layout-level redirect does NOT keep that data out of
  // the raw response stream (leak caught by curl 2026-08-10). Unauthenticated
  // ops traffic bounces to the app login here; is_admin is then enforced in
  // the /ops page itself (assertAdminPage) and per /api/ops route.
  if (hostname === "ops.pixeltrunk.com" && !pathname.startsWith("/api/")) {
    if (!user) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pixeltrunk.com";
      return NextResponse.redirect(`${appUrl}/login?redirect=/ops`);
    }
    const url = request.nextUrl.clone();
    url.pathname = pathname === "/" ? "/ops" : `/ops${pathname}`;
    return NextResponse.rewrite(url);
  }

  // Define public routes
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/api/auth/") ||
    // Public waitlist application (marketing site) — its own rate limit.
    pathname === "/api/waitlist" ||
    pathname.startsWith("/gallery") ||
    pathname.startsWith("/api/gallery") ||
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/api/stripe/webhook") ||
    // NOT all of /api/sps. That blanket rule dates from the push-import lane
    // (deleted 2026-08-11) and would leave any future /api/sps/* route that
    // forgets its own auth check publicly reachable. Only the enhancements
    // callback is genuinely session-less — SPS calls it server-side with a JWT
    // or the X-SPS-Key shared secret and has no cookie to present. Everything
    // else under /api/sps is photographer-facing (the connection screen, the
    // pull lane) and belongs behind the session.
    pathname.startsWith("/api/sps/enhancements") ||
    // Site-facing scene API enforces its own X-SPS-Key shared-secret auth
    // (like /api/sps) — the login redirect must not intercept it.
    pathname.startsWith("/api/site") ||
    // The guest-list download is authenticated BY ITS TOKEN, not by a session:
    // the recipient is a client who has no Pixeltrunk account. Behind the login
    // redirect the emailed link 307s to /login and is simply broken for the one
    // person it exists for. The route itself rate-limits, verifies the hashed
    // token, and requires a live share.
    pathname.startsWith("/api/guest-list/") ||
    pathname.startsWith("/dev");

  // Redirect unauthenticated users to login
  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from auth pages
  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - Static assets (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
