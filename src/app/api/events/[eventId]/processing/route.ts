import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/events/[eventId]/processing
 *
 * Live AI-processing state for one event: how much is done, how fast it's
 * going, and roughly how long is left. Deliberately cheap — three counts, no
 * row payloads — because the banner polls it while work is in flight.
 *
 * The ETA is measured, not guessed: rate comes from how many rows have been
 * indexed since the FIRST one on this event, so it reflects the actual GPU
 * throughput rather than a constant somebody typed in and never revisited.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const [totalRes, indexedRes, pendingRes, stalledRes, firstRes] = await Promise.all([
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("media_type", "image")
        .eq("processing_status", "complete"),
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("media_type", "image")
        .eq("processing_status", "complete")
        .not("ai_indexed_at", "is", null),
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("processing_status", "pending")
        // RECENT only. A row pending for hours is a ghost, not an upload in
        // flight — reporting it as "still uploading" tells the photographer to
        // wait for bytes that are never coming. Same 30-minute cutoff
        // countPendingUploads and the reconciler use.
        .gt("created_at", staleCutoff),
      supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("processing_status", "pending")
        .lt("created_at", staleCutoff),
      supabase
        .from("images")
        .select("ai_indexed_at")
        .eq("event_id", eventId)
        .not("ai_indexed_at", "is", null)
        .order("ai_indexed_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    for (const [label, res] of [
      ["total", totalRes],
      ["indexed", indexedRes],
      ["pending", pendingRes],
    ] as const) {
      if (res.error) throw new Error(`${label}: ${res.error.message}`);
    }

    const total = totalRes.count ?? 0;
    const indexed = indexedRes.count ?? 0;
    const uploading = pendingRes.count ?? 0;
    const stalled = stalledRes.count ?? 0;

    // An SPS import in flight, if there is one.
    //
    // Without this the banner reports `uploading` — the count of rows currently
    // pending — which during an import is the importer's CONCURRENCY WINDOW, not
    // the work remaining. Mason watched it say "6 photos still uploading" while
    // sixty had not been fetched yet: a number that reads as nearly-done and
    // means nothing of the kind. An import knows its own denominator, so say
    // that instead.
    const { data: pull, error: pullError } = await supabase
      .from("sps_pull_jobs")
      .select("id, status, expected_total, images_failed")
      .eq("event_id", eventId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pullError) throw new Error(`pull: ${pullError.message}`);

    let importing: {
      jobId: string;
      landed: number;
      expectedTotal: number | null;
      failed: number;
    } | null = null;

    if (pull) {
      // Count the rows, not the job's counter — same reason the import screen
      // does: rows are what actually landed.
      const { count: landed } = await supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .not("sps_image_id", "is", null);
      importing = {
        jobId: pull.id,
        landed: landed ?? 0,
        expectedTotal: pull.expected_total,
        failed: pull.images_failed,
      };
    }
    const startedAt = (firstRes.data as { ai_indexed_at: string } | null)?.ai_indexed_at ?? null;

    // Photos per minute, measured over this event's own run.
    let perMinute: number | null = null;
    let etaMinutes: number | null = null;
    if (startedAt && indexed > 1) {
      const elapsedMin = (Date.now() - new Date(startedAt).getTime()) / 60000;
      if (elapsedMin > 0.5) {
        perMinute = indexed / elapsedMin;
        if (perMinute > 0) etaMinutes = Math.ceil((total - indexed) / perMinute);
      }
    }

    return NextResponse.json({
      total,
      indexed,
      uploading,
      stalled,
      startedAt,
      perMinute,
      etaMinutes,
      importing,
      // Stalled rows must NOT keep this open forever — they're resolved by
      // dismissing the banner, not by waiting.
      // An import in flight DOES keep it open: photos are still arriving, so
      // "complete" would be a claim about a set that is still growing.
      complete:
        !importing && total > 0 && indexed >= total && uploading === 0,
    });
  } catch (error) {
    await reportSystemError("events.processing", error, { eventId });
    return NextResponse.json({ error: "Failed to load status" }, { status: 500 });
  }
}
