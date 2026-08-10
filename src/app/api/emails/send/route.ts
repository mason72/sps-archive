import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { recordUsage } from "@/lib/usage/record";
import { renderEmailShell } from "@/lib/email/shell";
import { reportSystemError } from "@/lib/monitoring/report";


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

    const { recipients, subject, bodyHtml, eventId, templateId, galleryUrl } = body;
    // Copy the photographer on their own send (default on; UI can opt out).
    const sendCopy = body.sendCopy !== false;
    // Opt-IN: printing a password into an email is a decision, not a default.
    // Note this is only the *request* — the password itself is read server-side
    // below; a client-supplied string is never printed.
    const includePassword = body.includePassword === true;

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

    // Basic abuse brake: a photographer sends a handful of gallery emails a
    // day; a compromised account blasting spam sends hundreds. 30/hour.
    const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
    const { count: recentSends } = await supabase
      .from("email_sends")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user!.id)
      .gte("created_at", hourAgo);
    if ((recentSends ?? 0) >= 30) {
      return NextResponse.json(
        { error: "Sending limit reached — try again in an hour" },
        { status: 429 }
      );
    }

    // The gallery link is NOT trusted from the client (a compromised account
    // could embed an arbitrary phishing URL in a branded email). The client
    // sends its gallery URL, but we only keep the slug — verify it's a real
    // share on one of THIS user's events and rebuild the canonical URL.
    let verifiedGalleryUrl: string | null = null;
    let verifiedSlug: string | null = null;
    let shareIsProtected = false;
    if (typeof galleryUrl === "string" && galleryUrl) {
      const slugMatch = (() => {
        try {
          return new URL(galleryUrl).pathname.match(/^\/gallery\/([^/]+)$/);
        } catch {
          return null;
        }
      })();
      const candidateSlug = slugMatch?.[1];
      if (candidateSlug) {
        const { data: shareRow } = await supabase
          .from("shares")
          .select("slug, password_hash, events!inner(user_id)")
          .eq("slug", candidateSlug)
          .eq("events.user_id", user!.id)
          .maybeSingle();
        if (shareRow) {
          verifiedSlug = shareRow.slug;
          shareIsProtected = !!shareRow.password_hash;
          const appUrl =
            process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
          verifiedGalleryUrl = `${appUrl.replace(/\/$/, "")}/gallery/${shareRow.slug}`;
        }
      }
      if (!verifiedGalleryUrl) {
        return NextResponse.json(
          { error: "Gallery link doesn't match one of your shares" },
          { status: 400 }
        );
      }
    }

    // Get user profile for from name
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, business_name")
      .eq("user_id", user!.id)
      .single();

    const fromName =
      profile?.business_name || profile?.display_name || "Pixeltrunk Gallery";

    // Event cover → email hero. We link the durable /cover redirect (keyed to
    // the share slug in galleryUrl), never a presigned URL — emails are opened
    // days later, presigns die in hours. Only attach it when a cover is set.
    let coverImageUrl: string | null = null;
    let eventName: string | null = null;
    let emailPassword: string | null = null;
    if (eventId) {
      const { data: event } = await supabase
        .from("events")
        .select("name, settings")
        .eq("id", eventId)
        .eq("user_id", user!.id)
        .single();
      eventName = event?.name ?? null;
      const cover = ((event?.settings as Record<string, unknown>)?.cover ?? {}) as {
        imageId?: string;
      };
      if (cover.imageId && verifiedGalleryUrl && verifiedSlug) {
        coverImageUrl = `${new URL(verifiedGalleryUrl).origin}/api/gallery/${verifiedSlug}/cover`;
      }

      // The password is read HERE, from the owner's own event, and only when
      // the *verified* share actually carries a hash. Two things this buys:
      // a compromised composer can't inject arbitrary text styled as a
      // credential, and we never tell a client "here's your password" for a
      // link that isn't protected — which is how a photographer ends up
      // believing a gallery is locked when it isn't.
      if (includePassword && shareIsProtected) {
        const eventPassword = (
          ((event?.settings as Record<string, unknown>)?.sharing ?? {}) as {
            password?: string;
          }
        ).password;
        if (typeof eventPassword === "string" && eventPassword.trim()) {
          emailPassword = eventPassword.trim();
        }
      }
    }

    // Wrap the composer's message in the branded HTML shell (clean layout +
    // a real "View Gallery" button instead of a bare text link).
    const renderedHtml = renderEmailShell({
      body: bodyHtml || "",
      galleryUrl: verifiedGalleryUrl,
      fromName,
      coverImageUrl,
      eventName,
      password: emailPassword,
    });

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
            // BCC keeps the photographer's copy invisible to clients
            ...(sendCopy && user!.email ? { bcc: [user!.email] } : {}),
            subject,
            html: renderedHtml,
          }),
        });

        if (!res.ok) {
          const err = await res.json();
          console.error("Resend API error:", err);
          void reportSystemError("emails.send", JSON.stringify(err), {
            userId: user!.id,
            eventId: eventId || undefined,
          });
          status = "failed";
        } else {
          await recordUsage({
            userId: user!.id,
            eventId: eventId || null,
            kind: "email_send",
            quantity: recipients.length,
            unit: "emails",
            metadata: { purpose: "gallery_email" },
          });
        }
      } catch (err) {
        console.error("Resend send failed:", err);
        void reportSystemError("emails.send", err);
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
        body_html: renderedHtml,
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
