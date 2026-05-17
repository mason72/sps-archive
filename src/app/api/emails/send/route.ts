import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { clientGalleryEmailHtml } from "@/lib/emails/client-gallery-template";
import { interpolateTemplate } from "@/lib/email/interpolate";
import { log } from "@/lib/log";

/**
 * POST /api/emails/send
 *
 * Send a per-recipient branded client-gallery email.
 *
 * Body:
 *   recipients:           string[]  — one or more email addresses
 *   subject:              string    — may contain template variables
 *   bodyHtml:             string    — raw TipTap body (no chrome)
 *   eventId?:             string
 *   templateId?:          string
 *   perRecipientName?:    Record<email, name>  — optional personalization
 *   galleryUrl?:          string    — needed for {gallery_link} interp
 *   eventName?:           string    — needed for {event_name} interp
 *
 * Each recipient gets a separate Resend call (so they don't see each
 * other's addresses) and personalized interpolation of {client_name}.
 * Outgoing HTML is wrapped in the branded chrome that EmailPreview
 * shows — preview and delivered email now match.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const body = await request.json();
    const {
      recipients,
      subject,
      bodyHtml,
      eventId,
      templateId,
      perRecipientName,
      galleryUrl,
      eventName,
    } = body as {
      recipients?: string[];
      subject?: string;
      bodyHtml?: string;
      eventId?: string;
      templateId?: string;
      perRecipientName?: Record<string, string>;
      galleryUrl?: string;
      eventName?: string;
    };

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: "At least one recipient is required" },
        { status: 400 }
      );
    }
    if (!subject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (recipients.length > 50) {
      return NextResponse.json(
        { error: "Maximum 50 recipients per send" },
        { status: 400 }
      );
    }

    // Loose dedupe + sanity check.
    const normalized = Array.from(
      new Set(
        recipients
          .map((r) => (typeof r === "string" ? r.trim() : ""))
          .filter((r) => r.length > 3 && r.includes("@"))
      )
    );
    if (normalized.length === 0) {
      return NextResponse.json(
        { error: "No valid recipient email addresses" },
        { status: 400 }
      );
    }

    // Photographer's profile drives the From name and branded chrome.
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("display_name, business_name, logo_url, website, branding")
      .eq("user_id", user!.id)
      .single();

    const fromName =
      profile?.business_name || profile?.display_name || "Pixeltrunk";
    const branding = (profile?.branding ?? {}) as Record<string, unknown>;
    const accentColor =
      typeof branding.accentColor === "string"
        ? (branding.accentColor as string)
        : undefined;

    // Resolve a usable logo URL — branding/<key> rows need presigning.
    let logoUrl: string | null = null;
    if (profile?.logo_url) {
      if (profile.logo_url.startsWith("branding/")) {
        const { getPresignedDownloadUrl } = await import("@/lib/r2/client");
        logoUrl = await getPresignedDownloadUrl(profile.logo_url, 86400);
      } else {
        logoUrl = profile.logo_url;
      }
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromAddress = process.env.RESEND_FROM_EMAIL || "gallery@resend.dev";

    // Per-recipient send. We fan out so each address sees only itself
    // (privacy) AND so {client_name} can be personalized when the
    // photographer provided a per-recipient mapping.
    type RecipientStatus = {
      email: string;
      status: "sent" | "failed" | "preview";
      error?: string;
    };
    const results: RecipientStatus[] = [];

    for (const email of normalized) {
      const clientName =
        (perRecipientName && perRecipientName[email]) ||
        email.split("@")[0] ||
        "there";

      const vars: Record<string, string> = {
        event_name: eventName || "",
        gallery_link: galleryUrl || "",
        business_name: profile?.business_name || fromName,
        photographer_name: profile?.display_name || fromName,
        client_name: clientName,
      };

      // Interpolate subject + body with this recipient's vars. The body
      // is then wrapped in the branded chrome.
      const personalizedSubject = interpolateTemplate(subject, vars);
      const personalizedBody = wrapGalleryLinkAsAnchor(
        interpolateTemplate(bodyHtml || "", vars),
        galleryUrl || ""
      );
      const finalHtml = clientGalleryEmailHtml({
        bodyHtml: personalizedBody,
        businessName: profile?.business_name || fromName,
        accentColor,
        logoUrl,
        website: profile?.website || null,
      });

      if (!resendKey) {
        results.push({ email, status: "preview" });
        continue;
      }

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${fromName} <${fromAddress}>`,
            to: [email],
            subject: personalizedSubject,
            html: finalHtml,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          log.error("emails/send", "Resend rejected message", {
            email,
            status: res.status,
            err: errBody,
          });
          results.push({
            email,
            status: "failed",
            error:
              (errBody as { message?: string })?.message ||
              `HTTP ${res.status}`,
          });
        } else {
          results.push({ email, status: "sent" });
        }
      } catch (err) {
        log.error("emails/send", "fetch threw", { email, err });
        results.push({
          email,
          status: "failed",
          error: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    const sentCount = results.filter((r) => r.status === "sent").length;
    const previewCount = results.filter((r) => r.status === "preview").length;
    const failedCount = results.filter((r) => r.status === "failed").length;

    // Aggregate status for the email_sends row. Strongest signal wins:
    // anything sent → sent; otherwise preview / failed.
    const aggregateStatus =
      sentCount > 0 ? "sent" : previewCount > 0 ? "preview" : "failed";

    // Record the send. recipients is stored as a native JSONB array.
    const { data: send, error: insertError } = await supabase
      .from("email_sends")
      .insert({
        user_id: user!.id,
        event_id: eventId || null,
        template_id: templateId || null,
        recipients: normalized,
        subject,
        body_html: bodyHtml || "",
        status: aggregateStatus,
      })
      .select()
      .single();

    if (insertError) {
      log.error("emails/send", "failed to record send", { err: insertError });
      // Don't fail the request — the email did go out (or not, but the
      // photographer already knows from `results`).
    }

    return NextResponse.json({
      sendId: send?.id ?? null,
      sent: sentCount,
      failed: failedCount,
      preview: previewCount,
      total: normalized.length,
      results,
      providerConfigured: !!resendKey,
    });
  } catch (error) {
    log.error("emails/send", "request failed", { err: error });
    return NextResponse.json(
      { error: "Failed to send email" },
      { status: 500 }
    );
  }
}

/**
 * Wrap any bare {gallery_link} URL occurrences inside the rendered
 * body that aren't already inside an <a href> with a proper anchor.
 *
 * The compose-time `gallery_link` template var is the RAW URL — never
 * a pre-baked anchor — so the template author can decide whether to
 * surround it with their own <a> in TipTap. This helper catches the
 * case where the URL ends up unwrapped (e.g., the photographer just
 * typed `{gallery_link}` in the body) so the client doesn't have to
 * copy-paste a bare URL.
 *
 * Conservative: only auto-anchor URL occurrences NOT preceded by
 * `href="` — we never re-wrap an existing anchor.
 */
function wrapGalleryLinkAsAnchor(html: string, galleryUrl: string): string {
  if (!galleryUrl) return html;
  const escaped = galleryUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Negative lookbehind for href=" to avoid re-wrapping existing anchors.
  const re = new RegExp(`(?<!href=")${escaped}(?!")`, "g");
  return html.replace(
    re,
    `<a href="${galleryUrl}" style="color:#1c1917;text-decoration:underline;">${galleryUrl}</a>`
  );
}
