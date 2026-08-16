import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";
import { inngest } from "@/lib/inngest/client";

/**
 * Per-instance throttle for the stalled-lane self-heal below — one kick per
 * event per window, so a banner polling every few seconds cannot flood the
 * queue. In-memory on purpose: several serverless instances each kicking once
 * is still a handful of events against a lane that debounces and de-dupes.
 */
const lastIndexKick = new Map<string, number>();
const INDEX_KICK_THROTTLE_MS = 5 * 60 * 1000;

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

/** Photos indexed per minute, from measured runs (see forecastMinutes below). */
const INDEX_RATE_PER_MIN = 54;

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

    /**
     * Photos per minute, measured over a TRAILING WINDOW — never over the
     * event's lifetime. The lifetime version divided `indexed` by time since
     * the FIRST ai_indexed_at, which turns any pause into a lie that
     * compounds: Staff Photos indexed 8 photos on day one, spent a day idle
     * (the lane debounces while uploads are in flight, and uploads ran all
     * day), and the "measured rate" became 8 photos / 21 hours — so the
     * banner told Mason his 1,308-photo event had "about 3475h 7m left" on a
     * job the pipeline does in ~24 minutes.
     *
     * A rate is only a rate while work is HAPPENING. So: count rows indexed
     * in the last ten minutes. Active lane → honest live throughput. Idle or
     * freshly-woken lane → no measured rate, and the banner falls back to the
     * known-throughput forecast below, which is what "no recent evidence"
     * should read as.
     */
    const RATE_WINDOW_MIN = 10;
    let perMinute: number | null = null;
    let etaMinutes: number | null = null;
    if (indexed > 1) {
      const windowStart = new Date(
        Date.now() - RATE_WINDOW_MIN * 60000
      ).toISOString();
      const { count: recentCount, error: recentErr } = await supabase
        .from("images")
        .select("id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .gte("ai_indexed_at", windowStart);
      if (recentErr) throw new Error(`recent-rate: ${recentErr.message}`);
      // A handful of rows in ten minutes is noise, not a rate — below that,
      // prefer the forecast to a wild extrapolation in either direction.
      if ((recentCount ?? 0) >= 10) {
        perMinute = (recentCount ?? 0) / RATE_WINDOW_MIN;
        etaMinutes = Math.ceil((total - indexed) / perMinute);
      }
    }
    // Before the first batch there is no measured rate, and the banner used to
    // say "Queued" with no sense of scale — Justin waited 31 minutes on 1,142
    // photos with nothing on screen suggesting how long, and went looking for
    // another way to do the job (2026-08-11). The throughput is known and
    // stable, so estimate rather than shrug: Island HQ indexed 1,142 in 21
    // minutes (54/min), and the pipeline's own shape agrees — 100 images per
    // batch at ~107 GPU-seconds is ~56/min. Explicitly a FORECAST; the measured
    // number replaces it the moment real work exists.
    const forecastMinutes =
      etaMinutes === null && total > indexed
        ? Math.max(1, Math.ceil((total - indexed) / INDEX_RATE_PER_MIN))
        : null;

    /**
     * SELF-HEAL A STALLED LANE. Indexing is settlement-triggered: the last
     * upload's settlement checks countPendingUploads() and SKIPS if any rows
     * are pending — and if those rows are then cleared by something that emits
     * no settlement (the reconciler, a sweep, Dismiss), nothing ever re-fires.
     * Staff Photos sat at 8 of 1,308 for a day this way, and the banner's
     * lifetime-window "measured rate" turned that stall into "3475h left"
     * (2026-08-16; same shape as lesson 67's ghost rows).
     *
     * This route is the perfect place to notice: it is polled BY the banner
     * that is showing the stall, and it already holds every fact needed —
     * work exists, nothing is uploading, nothing has indexed recently. So
     * notice, and kick. The lane itself debounces and skips when busy, so a
     * redundant kick is a no-op; fire-and-forget, because a status read must
     * never fail on a nicety.
     */
    if (!importing && uploading === 0 && total > indexed && indexed >= 0) {
      const newestIdx = await supabase
        .from("images")
        .select("ai_indexed_at")
        .eq("event_id", eventId)
        .not("ai_indexed_at", "is", null)
        .order("ai_indexed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const newestMs = newestIdx.data?.ai_indexed_at
        ? new Date(newestIdx.data.ai_indexed_at as string).getTime()
        : 0;
      const idleMs = Date.now() - newestMs;
      const lastKick = lastIndexKick.get(eventId) ?? 0;
      if (
        idleMs > INDEX_KICK_THROTTLE_MS &&
        Date.now() - lastKick > INDEX_KICK_THROTTLE_MS
      ) {
        lastIndexKick.set(eventId, Date.now());
        inngest
          .send({ name: "ai/index.requested", data: { eventId } })
          .catch(() => {
            /* a status read must never fail on a nicety */
          });
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
      /** Estimate used only before a measured rate exists. */
      forecastMinutes,
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
