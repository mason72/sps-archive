import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { parseDayWindow } from "@/lib/scout-integration/validate";
import { buildRosterIndex, gigsInWindow, type RosterRow } from "@/lib/scout-integration/gig-crew";
import { listEvents } from "@/lib/event-intel/google-calendar";
import { readAllRows } from "@/lib/supabase/paged";
import { loadOwnerUserId, scoutDb } from "@/lib/scout-integration/store";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/integrations/scout/gig-crew?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Who worked which gig, from the EXPOSURE calendar (read-only service account),
 * resolved against the studio's crew roster. At most 120 days per call. A
 * calendar that cannot be read is a 502, never an empty list: an empty answer
 * here would read as "nobody worked", which is the silent failure the calendar
 * client's own notes warn about.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const shiftDay = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString();

export async function GET(request: Request) {
  const refused = requireScoutKey(request);
  if (refused) return refused;

  const url = new URL(request.url);
  const window = parseDayWindow(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!window.ok) return NextResponse.json({ error: window.error }, { status: 400 });
  const { from, to } = window.value;

  try {
    const db = scoutDb();
    const ownerId = await loadOwnerUserId(db);
    const roster = await readAllRows<RosterRow>(() =>
      db.from("crew").select("id, display_name, full_name, primary_email, aliases").eq("user_id", ownerId)
    );

    let events;
    try {
      // A day of slack on each side in UTC, then filtered on the day the
      // calendar itself wrote, so no time zone moves a gig across the edge.
      events = await listEvents("exposure", {
        timeMin: shiftDay(from, -1),
        timeMax: shiftDay(to, 2),
        maxPages: 20,
      });
    } catch (err) {
      await reportSystemError("scout.gig-crew.calendar", err, { from, to });
      return NextResponse.json({ error: "The EXPOSURE calendar could not be read." }, { status: 502 });
    }

    const gigs = gigsInWindow(events, { from, to }, buildRosterIndex(roster));
    return NextResponse.json(gigs);
  } catch (err) {
    return scoutErrorResponse(err, "scout.gig-crew", { from, to });
  }
}
