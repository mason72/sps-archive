import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/upload/reconcile
 *
 * End-of-upload truth check. The client sends every imageId it believes
 * finished; the server answers with the ones whose row disagrees — still
 * "pending" (the finalize call never landed) or missing entirely. The client
 * surfaces those for retry instead of trusting its own bookkeeping.
 *
 * Born from the eBay HEADSHOTS incident: 458 uploads the client counted as
 * done were never finalized, and nothing noticed for three days. Any mismatch
 * found here is therefore also reported to system_errors — a mismatch means
 * the upload pipeline dropped something silently.
 */
export async function POST(request: NextRequest) {
  try {
    // getAuthUser returns the SERVICE client — the events!inner ownership
    // filter below is mandatory (see CLAUDE.md gotchas).
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { imageIds } = (await request.json()) as { imageIds: string[] };

    if (!Array.isArray(imageIds) || imageIds.length === 0) {
      return NextResponse.json({ error: "imageIds required" }, { status: 400 });
    }
    if (imageIds.length > 2000) {
      return NextResponse.json(
        { error: "Max 2000 imageIds per reconcile" },
        { status: 400 }
      );
    }

    const { data: rows, error: fetchError } = await supabase
      .from("images")
      .select("id, processing_status, events!event_id!inner(user_id)")
      .in("id", imageIds)
      .eq("events.user_id", user!.id);

    if (fetchError) throw fetchError;

    const byId = new Map((rows ?? []).map((r) => [r.id, r]));
    const unfinalized: string[] = [];
    const missing: string[] = [];
    for (const id of imageIds) {
      const row = byId.get(id);
      if (!row) missing.push(id);
      else if (row.processing_status === "pending") unfinalized.push(id);
    }

    if (unfinalized.length > 0 || missing.length > 0) {
      await reportSystemError(
        "upload.reconcile-mismatch",
        new Error(
          `${unfinalized.length} unfinalized, ${missing.length} missing of ${imageIds.length} client-completed uploads`
        ),
        {
          userId: user!.id,
          unfinalized: unfinalized.slice(0, 20),
          missing: missing.slice(0, 20),
        }
      );
    }

    return NextResponse.json({
      checked: imageIds.length,
      unfinalized,
      missing,
    });
  } catch (error) {
    console.error("Upload reconcile error:", error);
    await reportSystemError("upload.reconcile", error, {});
    return NextResponse.json({ error: "Reconcile failed" }, { status: 500 });
  }
}
