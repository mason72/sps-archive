import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/events/[eventId]/unfinished-uploads
 *
 * Files this event registered but never finished uploading.
 *
 * The upload queue lives in one browser tab's memory, so a crash, a closed lid
 * or a killed tab used to erase all knowledge that those files existed — the
 * photographer was never told, and found out when a client asked where their
 * headshots were (HDC // 2026: 404 photos, 12 people with nothing). The client
 * mirrors its queue to localStorage now, but that dies with a cache clear and
 * never crosses devices. The rows themselves are the durable record, and this
 * is the endpoint that reads them back.
 *
 * A row is reported when it is still "pending" and older than STALE_MINUTES —
 * the same threshold the nightly reconciler uses, so an upload actually in
 * flight (in this tab or another) is never reported as lost.
 *
 * Caveat, deliberately accepted: this does not HEAD R2, so a row whose binary
 * DID land but whose finalize call never confirmed is reported alongside the
 * genuinely-missing ones (~1% of the HDC incident). Checking would cost one
 * round-trip per row on a page load. The nightly reconciler heals those within
 * a day, and re-uploading one is harmless — so the cheap, slightly-generous
 * answer beats a slow one or none at all.
 */
const STALE_MINUTES = 30;
/** Cap on filenames returned; the count is always exact. */
const FILENAME_CAP = 500;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    // getAuthUser returns the SERVICE client, which bypasses RLS — the
    // events!inner ownership filter below is mandatory (CLAUDE.md gotchas).
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const staleCutoff = new Date(
      Date.now() - STALE_MINUTES * 60 * 1000
    ).toISOString();

    const { data, error, count } = await supabase
      .from("images")
      .select("original_filename, filename, events!event_id!inner(user_id)", {
        count: "exact",
      })
      .eq("event_id", eventId)
      .eq("events.user_id", user!.id)
      .eq("processing_status", "pending")
      .lt("created_at", staleCutoff)
      .order("created_at", { ascending: true })
      .limit(FILENAME_CAP);

    if (error) throw error;

    const filenames = (data ?? []).map((r) => r.original_filename ?? r.filename);

    return NextResponse.json({
      count: count ?? filenames.length,
      filenames,
      truncated: (count ?? 0) > filenames.length,
    });
  } catch (error) {
    console.error("Unfinished uploads error:", error);
    await reportSystemError("upload.unfinished-uploads", error, { eventId });
    return NextResponse.json(
      { error: "Failed to load unfinished uploads" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/events/[eventId]/unfinished-uploads
 *
 * Resolve the stalled rows for real: HEAD each one in R2, keep anything whose
 * binary actually landed (the nightly reconciler heals those), and delete the
 * rows that are genuinely empty.
 *
 * This exists because "Dismiss" used to write a localStorage timestamp and
 * nothing else — it silenced the banner in ONE browser while the ghost rows
 * stayed in the database. Mason dismissed HDC's nine and reasonably assumed
 * they were gone; hours later they were still rendering as blank tiles in the
 * grid, still inflating the photo count, and still counted as "uploads in
 * flight" — which was blocking AI indexing for all 5,778 finished photos.
 *
 * A control labelled "dismiss" that only hides is the same species of bug as a
 * fallback that fabricates success: the UI reports a state the system isn't in.
 * Unlike the GET above, the round-trip cost per row is fine here — this runs
 * once, on a click, over a handful of rows.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const staleCutoff = new Date(
      Date.now() - STALE_MINUTES * 60 * 1000
    ).toISOString();

    const { data: rows, error } = await supabase
      .from("images")
      .select("id, r2_key, original_filename, events!event_id!inner(user_id)")
      .eq("event_id", eventId)
      .eq("events.user_id", user!.id)
      .eq("processing_status", "pending")
      .lt("created_at", staleCutoff);
    if (error) throw error;

    // getObjectSize, not getObjectMetadata: the latter returns only custom
    // x-amz-meta-* fields, so its `.size` was always undefined and every row
    // read as "no bytes", including photos that had landed (found 2026-10-20).
    const { getObjectSize } = await import("@/lib/r2/client");
    const deletable: string[] = [];
    let recoverable = 0;
    let unchecked = 0;
    for (const row of (rows ?? []) as { id: string; r2_key: string | null }[]) {
      let bytes: number | null = null;
      if (row.r2_key) {
        try {
          bytes = await getObjectSize(row.r2_key);
        } catch {
          // R2 did not answer: unknown is not "gone", so keep the row for the
          // next click rather than delete a photo that may be there.
          unchecked += 1;
          continue;
        }
      }
      // Bytes present = a finalize that never landed, NOT a lost upload.
      // Deleting it would destroy a photo the photographer actually has.
      if (bytes !== null && bytes > 0) recoverable += 1;
      else deletable.push(row.id);
    }

    let deleted = 0;
    if (deletable.length > 0) {
      const { data: gone, error: delErr } = await supabase
        .from("images")
        .delete()
        .in("id", deletable)
        // A row that finalized after the check above is no longer a ghost.
        .eq("processing_status", "pending")
        .select("id");
      if (delErr) throw delErr;
      deleted = gone?.length ?? 0;
    }

    return NextResponse.json({
      deleted,
      recoverable,
      unchecked,
      checked: rows?.length ?? 0,
    });
  } catch (error) {
    await reportSystemError("events.unfinished-uploads.delete", error, { eventId });
    return NextResponse.json({ error: "Couldn't clear those rows" }, { status: 500 });
  }
}
