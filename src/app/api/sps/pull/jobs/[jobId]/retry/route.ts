import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { requestMissingRetry } from "@/lib/sps-integration/pull-sweep";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/sps/pull/jobs/[jobId]/retry
 *
 * Fetch the photos a FINISHED import left behind: the list its closing sweep
 * stored on the job, and nothing else. It deliberately does not compare SPS's
 * manifest with the gallery again, because the gallery has been curated since
 * and every photo a person removed would come back.
 *
 * Allowed under act-as for the same reason starting an import is (see
 * POST /api/sps/pull): it moves this account's own photos into its own event.
 *
 * `requestMissingRetry` scopes every statement to the caller's user id. That
 * filter is the authorization: getAuthUser hands back the SERVICE client.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { jobId } = await params;
    const result = await requestMissingRetry(supabase, user!.id, jobId);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.message, reason: result.reason },
        { status: result.reason === "not-found" ? 404 : 409 }
      );
    }

    return NextResponse.json({
      jobId: result.jobId,
      eventId: result.eventId,
      count: result.count,
    });
  } catch (error) {
    console.error("SPS pull retry error:", error);
    await reportSystemError("sps.pull-retry", error, {});
    return NextResponse.json(
      { error: "Could not start the retry" },
      { status: 500 }
    );
  }
}
