import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import {
  createGalleryPin,
  galleryPinCookieName,
} from "@/lib/shares/pin-session";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/** Constant-time PIN compare. Returns false if either side is the wrong length. */
function pinsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * POST /api/gallery/[slug]/verify-pin
 *
 * Public endpoint — verifies a 4-digit download PIN for a share. On success,
 * sets an HMAC-signed `pt-pin-<slug>` cookie that the download route reads.
 * Previously the PIN was passed in the download URL's query string, which
 * leaks it into browser history, server access logs, and Referer headers.
 *
 * Rate-limited to 5 attempts / 15min per IP+slug — without this limit the
 * 10,000-possible-PIN space is trivially brute-forced.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const limit = rateLimit(
      `verify-pin:${clientIp(request)}:${slug}`,
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

    const { pin } = (await request.json()) as { pin?: string };

    if (!pin || pin.length !== 4) {
      return NextResponse.json({ error: "4-digit PIN is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: share, error } = await supabase
      .from("shares")
      .select("id, download_pin")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !share || !share.download_pin) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    if (!pinsEqual(pin, share.download_pin)) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    const pinCookie = createGalleryPin(slug, share.id);
    const response = NextResponse.json({ success: true });
    response.cookies.set(galleryPinCookieName(slug), pinCookie.value, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: pinCookie.maxAge,
      path: "/",
    });
    return response;
  } catch (error) {
    console.error("Gallery verify-pin error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
