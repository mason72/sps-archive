import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { loadFillJob } from "@/lib/site/fill";

/**
 * GET /api/fill/[sectionId] — the job a crew pick link points at: its name,
 * what it still needs to go live, the photos already in it, and the client
 * galleries it was shot in. Owner-checked in loadFillJob.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sectionId: string }> }
) {
  const { sectionId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const load = await loadFillJob(supabase, user.id, sectionId);
    if (!load.ok) return NextResponse.json({ error: load.error }, { status: load.status });
    return NextResponse.json({ job: load.job });
  } catch (error) {
    await reportSystemError("fill.job", error, { sectionId });
    return NextResponse.json({ error: "Could not load this job" }, { status: 500 });
  }
}
