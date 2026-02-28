import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";


/**
 * POST /api/emails/send
 * Send an email using a template or custom content.
 *
 * Body:
 *  - recipients: string[] (email addresses)
 *  - subject: string
 *  - bodyHtml: string (rendered HTML)
 *  - eventId?: string
 *  - templateId?: string
 *
 * Currently logs the send and records it in email_sends.
 * Actual delivery via Resend/SendGrid can be added by configuring
 * RESEND_API_KEY in .env.local.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();

    const { recipients, subject, bodyHtml, eventId, templateId } = body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: "At least one recipient is required" },
        { status: 400 }
      );
    }

    if (!subject) {
      return NextResponse.json(
        { error: "Subject is required" },
        { status: 400 }
      );
    }

    // Get user profile for from name
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, business_name")
      .eq("user_id", user!.id)
      .single();

    const fromName =
      profile?.business_name || profile?.display_name || "Pixeltrunk Gallery";

    // Attempt to send via Resend if configured
    let status = "sent";
    const resendKey = process.env.RESEND_API_KEY;

    if (resendKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${fromName} <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
            to: recipients,
            subject,
            html: bodyHtml,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error("Resend API error:", err);
          status = "failed";
        }
      } catch (err) {
        console.error("Resend send failed:", err);
        status = "failed";
      }
    } else {
      // No email provider configured — preview only
      status = "preview";
    }

    // Record the send
    const { data: send, error } = await supabase
      .from("email_sends")
      .insert({
        user_id: user!.id,
        event_id: eventId || null,
        template_id: templateId || null,
        recipients: JSON.stringify(recipients),
        subject,
        body_html: bodyHtml || "",
        status,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({
      send: {
        id: send.id,
        status: send.status,
        recipients,
        subject,
      },
      message:
        status === "preview"
          ? "Email recorded (no email provider configured — add RESEND_API_KEY to .env.local to send)"
          : status === "sent"
            ? "Email sent successfully"
            : "Email send failed",
    });
  } catch (error) {
    console.error("Send email error:", error);
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}
