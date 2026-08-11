import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET    /api/sps/pull/jobs/[jobId]  — progress, for the import screen to poll.
 * DELETE /api/sps/pull/jobs/[jobId]  — cancel; the lane stops between slices.
 *
 * Both reads carry `.eq("user_id", …)`: getAuthUser hands back the SERVICE
 * client, so the filter is the authorization, not a convenience. A job row names
 * an event and its photo counts — small, but not this caller's business.
 *
 * Cancelling does NOT undo what has landed. The photos already in the archive
 * are real files with real bytes, and SPS has already been told it may release
 * its copies of them; deleting them here would be the only irreversible thing
 * in this flow. Stop means stop pulling more.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { jobId } = await params;

    const { data: job, error } = await supabase
      .from("sps_pull_jobs")
      .select(
        "id, event_id, sps_event_id, sps_event_name, status, expected_total, images_done, images_failed, images_skipped, bytes_copied, confirmed, failures, error, created_at, finished_at"
      )
      .eq("id", jobId)
      .eq("user_id", user!.id)
      .maybeSingle();

    if (error) throw error;
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (error) {
    console.error("SPS pull job status error:", error);
    await reportSystemError("sps.pull-job-status", error, {});
    return NextResponse.json(
      { error: "Could not read the import" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { jobId } = await params;

    // Only a live job can be cancelled — flipping a completed job to cancelled
    // would rewrite history, and the status filter is what makes this safe to
    // call twice.
    const { data: updated, error } = await supabase
      .from("sps_pull_jobs")
      .update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("user_id", user!.id)
      .in("status", ["queued", "running"])
      .select("id, status")
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return NextResponse.json(
        { error: "That import is not running." },
        { status: 409 }
      );
    }

    return NextResponse.json({ job: updated });
  } catch (error) {
    console.error("SPS pull cancel error:", error);
    await reportSystemError("sps.pull-cancel", error, {});
    return NextResponse.json(
      { error: "Could not cancel the import" },
      { status: 500 }
    );
  }
}
