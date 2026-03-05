import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
 *   /auth/callback, /gallery/*, /api/gallery/*, /api/inngest, /api/stripe/webhook, /api/sps/*
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
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Validate session with Supabase auth server
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Define public routes
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/forgot-password" ||
    pathname === "/reset-password" ||
    pathname.startsWith("/auth/callback") ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/gallery") ||
    pathname.startsWith("/api/gallery") ||
    pathname.startsWith("/api/inngest") ||
    pathname.startsWith("/api/stripe/webhook") ||
    pathname.startsWith("/api/sps") ||
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
