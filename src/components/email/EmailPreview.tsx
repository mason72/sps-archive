"use client";

import type { Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";

interface EmailPreviewProps {
  subject: string;
  bodyHtml: string;
  branding?: Branding;
  businessName?: string;
  logoUrl?: string;
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
}: EmailPreviewProps) {
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
