import { createServiceClient } from "@/lib/supabase/server";

/**
 * Silent-failure alarm: record a server-side error and alert the admin.
 *
 * Born from the guest-favorites bug — a 100% failure rate ran invisibly for
 * months because errors only hit console.error behind an optimistic UI. Call
 * this from catch blocks on flows whose failure the user won't see.
 *
 * Behavior:
 *  - Always inserts a system_errors row (queryable history).
 *  - Emails ADMIN_ALERT_EMAIL via Resend at most once per context per hour,
 *    so an error storm produces one email, not hundreds.
 *  - Never throws, never blocks the caller's response path for long — await it
 *    or fire-and-forget, both are safe.
 */
export async function reportSystemError(
  context: string,
  error: unknown,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown");

    // Throttle: has this context already alerted in the last hour?
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("system_errors")
      .select("id")
      .eq("context", context)
      .eq("notified", true)
      .gte("created_at", oneHourAgo)
      .limit(1);

    const adminEmail = process.env.ADMIN_ALERT_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;
    const shouldNotify = !recent?.length && !!adminEmail && !!resendKey;

    // Alpha triage: if the caller's detail carries userId/eventId (many
    // already do), lift them into the queryable attribution columns so
    // "whose action broke it" is one WHERE clause, not a jsonb dig.
    const userId = typeof detail?.userId === "string" ? detail.userId : null;
    const eventId = typeof detail?.eventId === "string" ? detail.eventId : null;

    await supabase.from("system_errors").insert({
      context,
      message,
      detail: detail ? JSON.parse(JSON.stringify(detail)) : null,
      notified: shouldNotify,
      user_id: userId,
      event_id: eventId,
    });

    if (shouldNotify) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Pixeltrunk Alerts <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
          to: [adminEmail],
          subject: `[Pixeltrunk] ${context} failing: ${message.slice(0, 80)}`,
          text: [
            `Context: ${context}`,
            `Message: ${message}`,
            detail ? `Detail: ${JSON.stringify(detail, null, 2)}` : null,
            "",
            "Further errors in this context are logged to system_errors but",
            "won't email again for an hour.",
          ]
            .filter((line): line is string => line !== null)
            .join("\n"),
        }),
      });
    }
  } catch (reportError) {
    // The alarm must never take down the flow it's watching.
    console.error("reportSystemError failed:", reportError);
  }
}
