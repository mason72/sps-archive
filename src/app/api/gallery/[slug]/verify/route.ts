import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyPassword } from "@/lib/shares/hash";

/**
 * POST /api/gallery/[slug]/verify
 *
 * Public endpoint — verifies password for a protected gallery.
 * Sets an auth cookie on success.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { password } = (await request.json()) as { password: string };

    if (!password) {
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

    const isValid = await verifyPassword(password, share.password_hash);

    if (!isValid) {
      return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
    }

    // Set auth cookie — lasts 7 days
    const response = NextResponse.json({ success: true });
    response.cookies.set(`gallery_auth_${slug}`, share.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Gallery verify error:", error);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
