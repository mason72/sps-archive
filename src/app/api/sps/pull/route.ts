import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { startSpsPull } from "@/lib/sps-integration/pull-event";
import { SpsPullError } from "@/lib/sps-integration/pull-client";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/sps/pull
 *
 * Start an import. Body:
 *   spsEventId    — the SPS event to pull
 *   deselected[]  — SPS image ids the photographer unchecked in review
 *   expectedTotal — display-only progress denominator (see below)
 *
 * The selection arrives as an EXCLUSION set. Everything is selected by default,
 * so the payload is normally empty, and — more importantly — the import does not
 * depend on how much of the grid was scrolled into view. A client that sent an
 * inclusion list would silently import only the pages it had loaded.
 *
 * `expectedTotal` is a hint for the progress bar and nothing else. Completion is
 * decided by the manifest running out of pages; SPS's own `imageCount` includes
 * the AI copies the manifest excludes, and no client-supplied number is allowed
 * to decide when an import is finished.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError, actingAs } = await getAuthUser();
    if (authError) return authError;

    // An import creates an event and moves tens of gigabytes into the owner's
    // storage. Not something to do from a support session.
    if (actingAs) {
      return NextResponse.json(
        { error: "Imports can only be started by the account owner." },
        { status: 403 }
      );
    }

    const body = (await request.json().catch(() => null)) as {
      spsEventId?: string;
      deselected?: unknown;
      expectedTotal?: unknown;
    } | null;

    if (!body?.spsEventId || typeof body.spsEventId !== "string") {
      return NextResponse.json(
        { error: "spsEventId is required" },
        { status: 400 }
      );
    }

    const deselected = Array.isArray(body.deselected)
      ? body.deselected.filter((v): v is string => typeof v === "string")
      : [];

    const expectedTotal =
      typeof body.expectedTotal === "number" && body.expectedTotal > 0
        ? Math.floor(body.expectedTotal)
        : null;

    const result = await startSpsPull(supabase, user!.id, {
      spsEventId: body.spsEventId,
      deselected,
      expectedTotal,
    });

    if (!result.ok) {
      // 409 across the board: not-connected, already-imported, in-progress and
      // empty are all "the request is fine, the state says no" — and each one
      // carries what the UI needs to act (the existing event, the running job).
      return NextResponse.json(
        {
          error: result.message,
          reason: result.reason,
          eventId: result.eventId,
          jobId: result.jobId,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      eventId: result.eventId,
      jobId: result.jobId,
    });
  } catch (error) {
    if (error instanceof SpsPullError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: error.kind === "unauthorized" ? 401 : 502 }
      );
    }
    console.error("SPS pull start error:", error);
    await reportSystemError("sps.pull-start", error, {});
    return NextResponse.json(
      { error: "Could not start the import" },
      { status: 500 }
    );
  }
}
