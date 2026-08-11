import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getSpsToken } from "@/lib/sps-integration/connection";
import { listSpsEvents, SpsPullError } from "@/lib/sps-integration/pull-client";
import { readSpsEventId } from "@/lib/sps-integration/event-link";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/sps/pull/events
 *
 * The import screen's list: this photographer's completed SPS events, each
 * marked with whether it is already in the archive.
 *
 * "Already imported" is decided by the LINK (`events.settings.spsEventId` via
 * readSpsEventId), never by matching names or dates. Names differ between the
 * two systems as a matter of routine and get renamed on both sides; the id is
 * exact (see event-link.ts, and lesson #78 on why a heuristic is not an
 * acceptable identity mechanism here).
 */
export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const token = await getSpsToken(supabase, user!.id);
    if (!token) {
      return NextResponse.json(
        { connected: false, events: [] },
        { status: 200 }
      );
    }

    // getAuthUser hands back the SERVICE client (bypasses RLS), so this read is
    // scoped to the caller explicitly — without the filter this returns every
    // photographer's events (lessons #2 and #14).
    const { data: archiveEvents, error: eventsError } = await supabase
      .from("events")
      .select("id, name, settings")
      .eq("user_id", user!.id);
    if (eventsError) throw eventsError;

    const importedBySpsId = new Map<string, { id: string; name: string }>();
    for (const ev of archiveEvents ?? []) {
      const spsId = readSpsEventId(ev.settings as Record<string, unknown>);
      if (spsId) importedBySpsId.set(spsId, { id: ev.id, name: ev.name });
    }

    // In-flight and finished pulls, so a resumable job is offered as a resume
    // rather than as a fresh import.
    const { data: jobs, error: jobsError } = await supabase
      .from("sps_pull_jobs")
      .select("id, sps_event_id, event_id, status, images_done, expected_total")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });
    if (jobsError) throw jobsError;

    const jobBySpsId = new Map<string, (typeof jobs)[number]>();
    for (const job of jobs ?? []) {
      if (!jobBySpsId.has(job.sps_event_id)) jobBySpsId.set(job.sps_event_id, job);
    }

    const spsEvents = await listSpsEvents(token);

    return NextResponse.json({
      connected: true,
      events: spsEvents.map((ev) => {
        const imported = importedBySpsId.get(ev.id) ?? null;
        const job = jobBySpsId.get(ev.id) ?? null;
        return {
          ...ev,
          archiveEventId: imported?.id ?? null,
          job: job
            ? {
                id: job.id,
                status: job.status,
                imagesDone: job.images_done,
                expectedTotal: job.expected_total,
              }
            : null,
        };
      }),
    });
  } catch (error) {
    if (error instanceof SpsPullError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: error.kind === "unauthorized" ? 401 : 502 }
      );
    }
    console.error("SPS pull event list error:", error);
    await reportSystemError("sps.pull-events", error, {});
    return NextResponse.json(
      { error: "Could not list SPS events" },
      { status: 500 }
    );
  }
}
