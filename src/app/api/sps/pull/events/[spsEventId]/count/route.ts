import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getSpsToken } from "@/lib/sps-integration/connection";
import {
  fetchManifestPage,
  SpsPullError,
} from "@/lib/sps-integration/pull-client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/sps/pull/events/[spsEventId]/count
 *
 * How many photos this import will actually move. Nothing else.
 *
 * Exists because the review screen had no honest total. It could only report how
 * many manifest pages the grid had scrolled through, and putting that number
 * beside the import button read as the scope of the import: "500 of about 9,107
 * loaded so far" next to "Import every photo" made Mason think he was importing
 * 500 (twice — first as a wrong button label, then as a wrong reassurance).
 *
 * Counted from the MANIFEST, walking every page, because that is the only source
 * that matches what will land. `event.imageCount` includes the AI copies the
 * manifest excludes, so it is close enough to look right and wrong enough to
 * misstate the job.
 *
 * A few seconds of metadata requests, once, when review opens.
 */
export const maxDuration = 120;

/** Pages before giving up. 60 × 500 = 30,000 photos, far past any real event. */
const PAGE_CAP = 60;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ spsEventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { spsEventId } = await params;

    const token = await getSpsToken(supabase, user!.id);
    if (!token) {
      return NextResponse.json(
        { error: "SimplePhotoShare is not connected." },
        { status: 409 }
      );
    }

    let total = 0;
    let lossy = 0;
    let offset = 0;

    for (let page = 0; page < PAGE_CAP; page++) {
      const p = await fetchManifestPage(token, spsEventId, offset);
      total += p.images.length;
      lossy += p.images.filter((i) => i.quality === "lossy").length;
      if (p.nextOffset === undefined) {
        return NextResponse.json({ total, lossy, complete: true });
      }
      offset = p.nextOffset;
    }

    // Honest partial rather than a floor pretending to be a total.
    return NextResponse.json({ total, lossy, complete: false });
  } catch (error) {
    if (error instanceof SpsPullError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: error.kind === "unauthorized" ? 401 : 502 }
      );
    }
    console.error("SPS manifest count error:", error);
    await reportSystemError("sps.pull-count", error, {});
    return NextResponse.json(
      { error: "Could not count the SPS manifest" },
      { status: 500 }
    );
  }
}
