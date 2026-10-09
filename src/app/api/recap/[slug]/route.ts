import { NextRequest, NextResponse } from "next/server";
import { resolveRecap } from "@/lib/recap/payload";

/**
 * GET /api/recap/[slug]
 *
 * Public, like the gallery API: the share slug is the credential, and a
 * password-protected share answers 401 with `requiresPassword` until the
 * gallery's own `gallery_auth_<slug>` cookie is present (the recap page
 * mounts the same PasswordGate, which posts to /api/gallery/[slug]/verify).
 * Nothing here writes: a recap read is not a gallery view.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const cookie = request.cookies.get(`gallery_auth_${slug}`)?.value;
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const resolved = await resolveRecap(slug, cookie, origin);

    if (resolved.kind === "gone") {
      return NextResponse.json(
        { error: resolved.status === 410 ? "This recap has expired" : "Recap not found" },
        { status: resolved.status }
      );
    }
    if (resolved.kind === "locked") {
      return NextResponse.json(
        {
          requiresPassword: true,
          eventName: resolved.eventName,
          customMessage: resolved.customMessage,
          photographer: resolved.photographer,
        },
        { status: 401 }
      );
    }
    return NextResponse.json(resolved.payload, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("Recap payload error:", err);
    return NextResponse.json({ error: "Failed to load recap" }, { status: 500 });
  }
}
