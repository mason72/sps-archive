"use client";

import { useState } from "react";
import type { Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";

interface EmailPreviewProps {
  subject: string;
  bodyHtml: string;
  branding?: Branding;
  businessName?: string;
  logoUrl?: string;
  /** Event cover hero (the /api/gallery/[slug]/cover URL). Hidden if it 404s. */
  coverImageUrl?: string;
  /**
   * Gallery password, when the sender chose to include it. Mirrors the card
   * `renderEmailShell` emits — if this preview and that shell ever disagree,
   * the preview is lying about the email being sent.
   */
  password?: string | null;
}

/**
 * EmailPreview — Renders a branded email preview card.
 * Shows how the email will look to recipients.
 */
export function EmailPreview({
  subject,
  bodyHtml,
  branding = DEFAULT_BRANDING,
  businessName,
  logoUrl,
  coverImageUrl,
  password,
}: EmailPreviewProps) {
  // Hide the hero when the event has no cover (the cover route 404s).
  const [coverFailed, setCoverFailed] = useState(false);

  return (
    <div className="border border-stone-200 bg-white overflow-hidden">
      {/* Email chrome header */}
      <div className="border-b border-stone-100 px-5 py-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] text-stone-400 uppercase tracking-widest">
            Subject
          </span>
        </div>
        <p className="text-[14px] text-stone-900 font-medium">
          {subject || "No subject"}
        </p>
      </div>

      {/* Branded email body */}
      <div style={{ backgroundColor: branding.backgroundColor }}>
        {/* Cover hero — mirrors the real email's full-bleed cover image */}
        {coverImageUrl && !coverFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={coverImageUrl}
            alt=""
            className="block w-full h-auto"
            onError={() => setCoverFailed(true)}
          />
        )}

        {/* Header bar */}
        <div
          className="px-6 py-5 border-b"
          style={{
            borderBottomColor: branding.primaryColor + "15",
          }}
        >
          <div className={branding.logoPlacement === "center" ? "text-center" : ""}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt=""
                className="h-8 object-contain"
                style={{
                  margin:
                    branding.logoPlacement === "center" ? "0 auto" : undefined,
                }}
              />
            ) : (
              <span
                className="font-editorial text-[20px]"
                style={{ color: branding.primaryColor }}
              >
                {businessName || "Your Studio"}
              </span>
            )}
          </div>
        </div>

        {/* Body content */}
        <div
          className="px-6 py-6 text-[14px] leading-relaxed email-body"
          style={{ color: branding.secondaryColor }}
          dangerouslySetInnerHTML={{
            __html:
              bodyHtml ||
              '<p style="color: #a8a29e; font-style: italic;">Email body will appear here…</p>',
          }}
        />

        {/* Password card — mirrors passwordCard() in lib/email/shell.ts */}
        {password && (
          <div className="px-6 pb-6 -mt-2">
            <div className="border border-stone-200 bg-stone-50 rounded-lg px-5 py-4 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 mb-2">
                Gallery Password
              </p>
              <p className="font-mono text-[17px] font-semibold tracking-[0.14em] text-stone-900 break-all">
                {password}
              </p>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="px-6 py-4 border-t text-center"
          style={{
            borderTopColor: branding.primaryColor + "10",
            color: branding.secondaryColor + "80",
          }}
        >
          <p className="text-[11px]">
            Sent via{" "}
            <span style={{ color: branding.primaryColor }}>Pixeltrunk</span>
          </p>
        </div>
      </div>
    </div>
  );
}
