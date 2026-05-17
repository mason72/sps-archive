import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { hashPassword, verifyPassword } from "@/lib/shares/hash";
import {
  createGallerySession,
  gallerySessionCookieName,
} from "@/lib/shares/session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/gallery/[slug]/verify
 *
 * Public endpoint — verifies a password for a protected gallery and issues
 * an HMAC-signed session cookie.
 *
 * Hardened in Phase 0:
 *   - Password verification supports both the new PBKDF2-SHA256 (600k iter)
 *     format AND the legacy SHA-256 format. On a successful legacy match,
 *     the hash is silently re-stored in the new format so the next verify
 *     uses strong KDF + constant-time compare end-to-end.
 *   - Cookie value is an HMAC-signed token (slug + shareId + exp) bound by
 *     GALLERY_SESSION_SECRET — not the raw share.id (which is sensitive and
 *     was previously a forgeable bearer token).
 *   - Rate-limited to 5 attempts / 15min per IP+slug.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const limit = rateLimit(
      `verify:${clientIp(request)}:${slug}`,
      5,
      15 * 60 * 1000
    );
    if (!limit.success) {
      return NextResponse.json(
        { error: "Too many attempts. Try again in a few minutes." },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)),
          },
        }
      );
    }

    const { password } = (await request.json()) as { password?: string };

    if (!password || typeof password !== "string") {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: share, error } = await supabase
      .from("shares")
      .select("id, password_hash")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !share || !share.password_hash) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    const result = await verifyPassword(password, share.password_hash);

    if (!result.valid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    // Upgrade legacy SHA-256 hashes opportunistically — only after we've
    // confirmed the user knows the password, so the rehash is safe.
    if (result.needsRehash) {
      try {
        const newHash = await hashPassword(password);
        await supabase
          .from("shares")
          .update({ password_hash: newHash })
          .eq("id", share.id);
      } catch (err) {
        console.error(`[verify] legacy hash upgrade failed for share ${share.id}:`, err);
        // Non-critical — old hash continues to verify next time.
      }
    }

    // Issue an HMAC-signed session cookie. Lasts 7 days.
    const session = createGallerySession(slug, share.id);
    const response = NextResponse.json({ success: true });
    response.cookies.set(gallerySessionCookieName(slug), session.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: session.maxAge,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Gallery verify error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
