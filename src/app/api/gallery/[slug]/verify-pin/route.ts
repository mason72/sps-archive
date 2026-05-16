import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/** Constant-time PIN compare. Returns false if either side is the wrong length. */
function pinsEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * POST /api/gallery/[slug]/verify-pin
 *
 * Public endpoint — verifies a 4-digit download PIN for a share.
 * Rate-limited to 5 attempts per 15 minutes per IP+slug; with only 10k
 * possible PINs an unlimited endpoint is trivially brute-forced.
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
        { status: 429, headers: { "Retry-After": String(Math.ceil((limit.reset - Date.now()) / 1000)) } }
      );
    }

    const { pin } = (await request.json()) as { pin: string };

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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Gallery verify-pin error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
