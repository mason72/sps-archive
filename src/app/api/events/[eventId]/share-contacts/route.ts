import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { loadShareContacts } from "@/lib/event-intel/share-contacts";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/events/[eventId]/share-contacts — recipient suggestions for the
 * share email (calendar contact, the client's past recipients, prior sends).
 *
 * INTERNAL: Event Intel access via `getIntelUser()`, ownership proven inside
 * `loadShareContacts`. Client addresses never reach a share or guest path.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;

    const result = await loadShareContacts(supabase, { id: user!.id, email: user!.email }, eventId);
    if (!result) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const { calendarError, ...body } = result;
    if (calendarError) {
      void reportSystemError("api.events.shareContacts.calendar", calendarError, { eventId });
    }
    return NextResponse.json(body);
  } catch (error) {
    console.error("GET /api/events/[eventId]/share-contacts:", error);
    void reportSystemError("api.events.shareContacts", error, { eventId });
    return NextResponse.json({ error: "Failed to load suggestions" }, { status: 500 });
  }
}
