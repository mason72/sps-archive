"use client";

import { useState } from "react";
import type { Branding } from "@/types/user-profile";
import { DEFAULT_BRANDING } from "@/types/user-profile";
import { renderEmailContent } from "@/lib/email/shell";
import type { SpsRecap } from "@/lib/recap/types";

interface EmailPreviewProps {
  subject: string;
  bodyHtml: string;
  branding?: Branding;
  businessName?: string;
  logoUrl?: string;
  /** Event cover hero (the /api/gallery/[slug]/cover URL). Hidden if it 404s. */
  coverImageUrl?: string;
  /**
   * The cover is a composed design (mosaic/solid) whose raster hasn't been
   * generated yet. While true the hero shows an honest "being composed" state
   * instead of the route's fallback frame — a real photo that ISN'T the cover
   * reads as "my cover is missing" (Mason, 2026-08-28). The sent email is
   * safe either way: its hero is a durable redirect that self-heals.
   */
  coverComposing?: boolean;
  /**
   * The share link. Lets the preview make the same call the send path makes
   * about where the gallery button goes (in place of a link-only line, or
   * appended).
   */
  galleryUrl?: string;
  /** Gallery password, when the sender chose to include it. */
  password?: string | null;
  /** Download PIN, when the sender chose to include it. */
  downloadPin?: string | null;
  /**
   * The guest-list card. No URL: the preview shows what the client sees, and
   * the client sees a button. Printing the live token into an owner-facing
   * pane would be the one place it leaks, so the button here points nowhere.
   */
  guestList?: {
    message?: string | null;
    filename?: string | null;
    sizeBytes?: number | null;
  } | null;
  /**
   * The delivery recap card, when the sender chose to include it and the
   * event has numbers worth showing. `url` is the recap page; the preview
   * builds it from the share slug the way the send route does.
   */
  recap?: { data: SpsRecap; url: string } | null;
}

/** Stands in for the guest-list link, which the preview is never handed. */
const NOWHERE = "#";

/**
 * EmailPreview — Renders a branded email preview card.
 * Shows how the email will look to recipients.
 *
 * Everything inside the body, the buttons and cards included, is
 * `renderEmailContent`'s output: the same string the send route mails. This
 * component used to redraw those cards by hand, and for months it drew no
 * gallery button at all while every sent email carried one.
 */
export function EmailPreview({
  subject,
  bodyHtml,
  branding = DEFAULT_BRANDING,
  businessName,
  logoUrl,
  coverImageUrl,
  coverComposing,
  galleryUrl,
  password,
  downloadPin,
  guestList,
  recap,
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
        {/* Cover hero — mirrors the real email's full-bleed cover image.
            While the composed cover (mosaic/solid) is still being rendered,
            say so rather than showing the route's fallback frame — a photo
            that isn't the cover reads as the cover being broken. */}
        {coverImageUrl && coverComposing ? (
          <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-2 bg-stone-100 px-6 text-center">
            <span className="text-[12px] font-medium text-stone-500">
              Your cover design is being composed
            </span>
            <span className="text-[11px] leading-relaxed text-stone-400">
              It will appear here in about a minute — and the sent email always
              shows the finished cover.
            </span>
          </div>
        ) : (
          coverImageUrl &&
          !coverFailed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverImageUrl}
              alt=""
              className="block w-full h-auto"
              onError={() => setCoverFailed(true)}
            />
          )
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

        {/* Body content, with the gallery block and guest-list card the send
            path would place. A click opens the link in a new tab, so trying a
            button never costs the draft. */}
        <div
          className="px-6 py-6 text-[14px] leading-relaxed email-body"
          style={{ color: branding.secondaryColor }}
          onClick={(e) => {
            const link = (e.target as HTMLElement).closest("a");
            if (!link) return;
            e.preventDefault();
            const href = link.getAttribute("href");
            if (href && href !== NOWHERE) {
              window.open(href, "_blank", "noopener,noreferrer");
            }
          }}
          dangerouslySetInnerHTML={{
            __html: renderEmailContent({
              body:
                bodyHtml ||
                '<p style="color: #a8a29e; font-style: italic;">Email body will appear here…</p>',
              galleryUrl,
              password,
              downloadPin,
              guestList: guestList ? { url: NOWHERE, ...guestList } : null,
              recap,
            }),
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
            {businessName ? `${businessName} · ` : ""}Delivered with{" "}
            <span style={{ color: branding.primaryColor }}>Pixeltrunk</span>
          </p>
        </div>
      </div>
    </div>
  );
}
