import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/upload/unfinished-summary
 *
 * Every gallery of this photographer's that registered files it never finished
 * uploading, newest loss first.
 *
 * The per-event banner only speaks when you are already looking at the event
 * that lost work — which is exactly the gallery you have no reason to open if
 * you believe the upload finished. HDC // 2026 sat broken for a day for that
 * reason. This is the signal that reaches someone who is not looking.
 *
 * Same staleness threshold as the reconciler (30 min), so an upload actually in
 * flight is never reported as lost. See the sibling route
 * /api/events/[eventId]/unfinished-uploads for the per-event detail and for why
 * this deliberately does not HEAD R2.
 */
const STALE_MINUTES = 30;
/**
 * Rows pulled to build the per-gallery breakdown. The TOTAL is always exact
 * (separate head-only count), so blowing this cap degrades the breakdown, never
 * the headline — a summary that under-reports its own scale is the bug this
 * whole incident was about.
 */
const ROW_CAP = 10_000;
/**
 * PostgREST refuses to return more than 1,000 rows per request and does NOT
 * error when you ask for more — `.limit(10_000)` silently yields 1,000. So the
 * breakdown is paged explicitly; a single limit() call reported "1000+" against
 * a real 2,258 and would have understated every large loss.
 */
const PAGE_SIZE = 1000;

export async function GET() {
  try {
    // getAuthUser returns the SERVICE client, which bypasses RLS — the
    // events!inner ownership filter below is mandatory (CLAUDE.md gotchas).
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const staleCutoff = new Date(
      Date.now() - STALE_MINUTES * 60 * 1000
    ).toISOString();

    const { count: total, error: countError } = await supabase
      .from("images")
      .select("id, events!event_id!inner(user_id)", {
        count: "exact",
        head: true,
      })
      .eq("events.user_id", user!.id)
      .eq("processing_status", "pending")
      .lt("created_at", staleCutoff);
    if (countError) throw countError;

    if (!total) {
      return NextResponse.json({ total: 0, events: [], truncated: false });
    }

    type Row = { event_id: string; created_at: string; events: unknown };
    const rows: Row[] = [];
    for (let from = 0; from < Math.min(total, ROW_CAP); from += PAGE_SIZE) {
      const { data: page, error: rowsError } = await supabase
        .from("images")
        .select("event_id, created_at, events!event_id!inner(user_id, name)")
        .eq("events.user_id", user!.id)
        .eq("processing_status", "pending")
        .lt("created_at", staleCutoff)
        // Ordered by a non-unique column, so ties could shuffle between pages;
        // id breaks them and keeps paging stable.
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (rowsError) throw rowsError;
      if (!page?.length) break;
      rows.push(...(page as Row[]));
      if (page.length < PAGE_SIZE) break;
    }

    const byEvent = new Map<
      string,
      { eventId: string; name: string; count: number; lastAt: string }
    >();
    for (const row of rows) {
      const ev = row.events as unknown as { name?: string } | null;
      const existing = byEvent.get(row.event_id);
      if (existing) {
        existing.count++;
      } else {
        byEvent.set(row.event_id, {
          eventId: row.event_id,
          name: ev?.name ?? "Untitled event",
          count: 1,
          // Rows arrive newest-first, so the first one seen is the latest.
          lastAt: row.created_at,
        });
      }
    }

    return NextResponse.json({
      total,
      events: [...byEvent.values()].sort((a, b) =>
        a.lastAt < b.lastAt ? 1 : -1
      ),
      truncated: total > rows.length,
    });
  } catch (error) {
    console.error("Unfinished summary error:", error);
    await reportSystemError("upload.unfinished-summary", error, {});
    return NextResponse.json(
      { error: "Failed to load unfinished uploads" },
      { status: 500 }
    );
  }
}
