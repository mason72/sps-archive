import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/gallery/[slug]/verify-pin
 *
 * Public endpoint -- verifies a 4-digit download PIN for a share.
 * Returns { success: true } if the PIN matches.
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

    const { data: share, error } = await supabase
      .from("shares")
      .select("id, download_pin")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();

    if (error || !share || !share.download_pin) {
      return NextResponse.json({ error: "Gallery not found" }, { status: 404 });
    }

    if (pin !== share.download_pin) {
      return NextResponse.json({ error: "Incorrect PIN" }, { status: 401 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Gallery verify-pin error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
