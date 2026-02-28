import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";


/**
 * GET /api/events/[eventId]/emails
 * List all email sends for an event.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { eventId } = await params;

    // Verify event ownership
    const { data: event } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .single();

    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: rawSends, error } = await supabase
      .from("email_sends")
      .select("id, subject, recipients, status, sent_at")
      .eq("event_id", eventId)
      .eq("user_id", user!.id)
      .order("sent_at", { ascending: false });

    if (error) throw error;

    const sends = (rawSends || []).map((s: Record<string, unknown>) => {
      let recipients: string[] = [];
      try {
        recipients =
          typeof s.recipients === "string"
            ? JSON.parse(s.recipients as string)
            : (s.recipients as string[]) || [];
      } catch {
        recipients = [];
      }

      return {
        id: s.id,
        subject: s.subject,
        recipients,
        status: s.status,
        sentAt: s.sent_at,
      };
    });

    return NextResponse.json({ sends });
  } catch (error) {
    console.error("List email sends error:", error);
    return NextResponse.json(
      { error: "Failed to load email history" },
      { status: 500 }
    );
  }
}
