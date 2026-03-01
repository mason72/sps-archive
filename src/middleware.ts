import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Middleware — Route protection + Supabase session management.
 *
 * Public routes (no auth required):
 *   /, /login, /signup, /gallery/*, /api/gallery/*, /api/inngest
 *
 * Protected routes (redirect to /login if unauthenticated):
 *   /events/*, /api/events/*, /api/upload/*, /api/search/*,
 *   /api/images/*, /api/stacks/*, /api/shares/*
 */
export async function middleware(request: NextRequest) {
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

  const { pathname } = request.nextUrl;

  // Define public routes
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname.startsWith("/gallery") ||
    pathname.startsWith("/api/gallery") ||
    pathname.startsWith("/api/inngest") ||
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
