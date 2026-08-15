import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getSpsToken } from "@/lib/sps-integration/connection";
import {
  fetchManifestPage,
  SpsPullError,
} from "@/lib/sps-integration/pull-client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/sps/pull/events/[spsEventId]/manifest?offset=0
 *
 * One manifest page for the review grid. A thin pass-through, for one reason
 * that matters: the SPS token is a stored credential and must never reach the
 * browser, so the browser cannot call SPS directly.
 *
 * `previewUrl` is resolved here rather than in the client — SPS's small variant
 * when it sends one, the full original otherwise. That fallback is why the grid
 * lazy-loads: without a thumbnail, a preview costs a full camera file.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ spsEventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { spsEventId } = await params;
    const offset = Math.max(
      0,
      Number.parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0
    );

    const token = await getSpsToken(supabase, user!.id);
    if (!token) {
      return NextResponse.json(
        { error: "SimplePhotoShare is not connected." },
        { status: 409 }
      );
    }

    const page = await fetchManifestPage(token, spsEventId, offset);

    return NextResponse.json({
      event: page.event,
      images: page.images.map((img) => ({
        id: img.id,
        originalFilename: img.originalFilename,
        width: img.width,
        height: img.height,
        quality: img.quality,
        alreadyPulled: img.alreadyPulled,
        previewUrl: img.thumbUrl || img.url,
        /**
         * The camera-size source, for tag-at-import. A face embedded from a
         * 200px thumbnail is a bad reference; the tag path re-fetches THIS and
         * downscales server-side to what the detector wants. Same presigned
         * URL the import itself would use — nothing new is exposed.
         */
        fullUrl: img.url,
        /**
         * True when the preview IS the full camera file, because SPS sent no
         * small variant for this row. The grid says so rather than just being
         * slow — an unexplained crawl through a 6,000-frame review is how the
         * review step gets abandoned.
         */
        previewIsFullSize: !img.thumbUrl,
      })),
      nextOffset: page.nextOffset ?? null,
    });
  } catch (error) {
    if (error instanceof SpsPullError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        {
          status:
            error.kind === "unauthorized"
              ? 401
              : error.kind === "not-found"
                ? 404
                : 502,
        }
      );
    }
    console.error("SPS manifest page error:", error);
    await reportSystemError("sps.pull-manifest", error, {});
    return NextResponse.json(
      { error: "Could not read the SPS manifest" },
      { status: 500 }
    );
  }
}
