import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkAuthRateLimit, clientIp } from "@/lib/security/rate-limit";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import {
  authorizeShareDownload,
  selectShareImage,
} from "@/lib/gallery/download-core";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/gallery/[slug]/image-download
 *
 * Hands a guest the presigned original for ONE photo, after the same server
 * gates the bulk ZIP runs: active share, unexpired, downloads allowed,
 * password cookie, and the per-image PIN.
 *
 * This route exists because the individual-download PIN used to be enforced
 * only in the browser: the gallery payload embedded a presigned downloadUrl
 * for every photo whenever allow_download was set, so a guest past the
 * password gate could read the originals straight out of the Network tab and
 * never see the PIN prompt (pre-alpha audit, 2026-08-10). When the PIN is
 * required the payload now ships no URL at all, and this is the only way to
 * get one.
 *
 * Body: { imageId, dt?, pin? } — dt is the token from /verify-pin (preferred);
 * a raw pin is honored as a fallback and rate-limited inside the authorizer.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  try {
    const supabase = createServiceClient();

    let body: Record<string, unknown> = {};
    try {
      body = await request.json();
    } catch {
      // fall through to the imageId check below
    }
    const imageId = typeof body.imageId === "string" ? body.imageId : null;
    if (!imageId) {
      return NextResponse.json({ error: "imageId is required" }, { status: 400 });
    }

    const auth = await authorizeShareDownload(supabase, slug, {
      cookieShareId: request.cookies.get(`gallery_auth_${slug}`)?.value ?? null,
      downloadToken: typeof body.dt === "string" ? body.dt : null,
      pin: typeof body.pin === "string" ? body.pin : null,
      ip: clientIp(request),
      kind: "individual",
    });
    if (!auth.ok) {
      return NextResponse.json({ error: auth.message }, { status: auth.status });
    }

    // Past the gates, every request mints a presigned original. Counted AFTER
    // authorization so a guest re-prompted for an expired token does not
    // spend download budget on the 401s; the PIN path has its own failure
    // limiter inside the authorizer. Budget reasoning lives on the constant.
    const ip = clientIp(request);
    if (!(await checkAuthRateLimit(supabase, "image-download", slug, ip))) {
      return NextResponse.json(
        { error: "Too many downloads — try again in a few minutes" },
        { status: 429 }
      );
    }

    const image = await selectShareImage(supabase, auth.share, imageId);
    if (!image) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    // Short TTL: this URL is fetched at the moment of the click, not baked
    // into a payload that lives as long as the open tab.
    const downloadUrl = await getPresignedDownloadUrl(
      image.r2_key,
      600,
      image.original_filename || "image"
    );

    return NextResponse.json({ downloadUrl });
  } catch (error) {
    console.error("Gallery image-download error:", error);
    void reportSystemError("gallery.image-download", error, { slug });
    return NextResponse.json({ error: "Download failed" }, { status: 500 });
  }
}
