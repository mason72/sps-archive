import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { timingSafeEqualStr } from "@/lib/shares/hash";
import { createDownloadToken } from "@/lib/shares/download-token";
import {
  checkAuthRateLimit,
  resetAuthRateLimit,
  clientIp,
} from "@/lib/security/rate-limit";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/gallery/[slug]/verify-pin
 *
 * Public endpoint -- verifies a 4-digit download PIN for a share.
 * Returns { success: true } if the PIN matches. Rate-limited per slug + IP
 * (a 4-digit PIN is 10k combinations — unlimited attempts would fall fast).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { pin } = (await request.json()) as { pin: string };

    if (!pin || pin.length !== 4) {
      return NextResponse.json({ error: "4-digit PIN is required" }, { status: 400 });
    }

    const supabase = createServiceClient();

    if (!(await checkAuthRateLimit(supabase, "pin", slug, clientIp(request)))) {
      return NextResponse.json(
        { error: "Too many attempts — try again in a few minutes" },
        { status: 429 }
      );
    }

    const { data: share, error } = await supabase
      .from("shares")
      .select("id, download_pin")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !share || !share.download_pin) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    if (!timingSafeEqualStr(pin, share.download_pin)) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    // Success clears the counter — only failures accumulate.
    void resetAuthRateLimit(supabase, "pin", slug, clientIp(request));

    // Bulk downloads authenticate with this token from here on, so the raw
    // PIN never rides a URL again (audit #3: PINs were landing in access logs).
    return NextResponse.json({
      success: true,
      downloadToken: createDownloadToken(share.id),
    });
  } catch (error) {
    console.error("Gallery verify-pin error:", error);
    void reportSystemError("gallery.verify-pin", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
