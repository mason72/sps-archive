import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { isDay } from "@/lib/scout-integration/validate";
import { scoutDb } from "@/lib/scout-integration/store";
import { listClientGalleries } from "@/lib/scout-integration/client-bts";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";

/**
 * GET /api/integrations/scout/client-galleries?date=YYYY-MM-DD&days=N[&calendar_event_id=…]
 *
 * Candidate client galleries for a gig: those linked to its EXACT calendar
 * event (`match: "calendar"`), then to the same recurring series only
 * (`match: "series"`), then those dated inside the gig's days, padded a day
 * each side (`match: "date"`). `date` may be omitted when calendar_event_id is
 * given: then only the calendar and series matches come back.
 * At most 30, newest first within each group. Scout auto-links only on a
 * calendar match; otherwise an admin picks.
 */
export const runtime = "nodejs";
export const maxDuration = 30;

const CLIENT_GALLERY_MAX_DAYS = 31;

export async function GET(request: Request) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const daysRaw = url.searchParams.get("days") ?? "1";
  const days = Number(daysRaw);
  const calendarEventId = url.searchParams.get("calendar_event_id")?.trim() || null;
  // Without a date, a calendar id alone asks for its calendar/series matches.
  if (date == null && !calendarEventId) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) or calendar_event_id is required." }, { status: 400 });
  }
  if (date != null && !isDay(date)) return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  if (!/^\d+$/.test(daysRaw) || !Number.isInteger(days) || days < 1 || days > CLIENT_GALLERY_MAX_DAYS) {
    return NextResponse.json({ error: `days must be a whole number from 1 to ${CLIENT_GALLERY_MAX_DAYS}.` }, { status: 400 });
  }
  if (calendarEventId && (calendarEventId.length > 1024 || /[\s,]/.test(calendarEventId))) {
    return NextResponse.json({ error: "calendar_event_id is not a calendar event id." }, { status: 400 });
  }
  try {
    return NextResponse.json({ candidates: await listClientGalleries(scoutDb(), { date, days, calendarEventId }) });
  } catch (err) {
    return scoutErrorResponse(err, "scout.client-galleries", { date, days });
  }
}
