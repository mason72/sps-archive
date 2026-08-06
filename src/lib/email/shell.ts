/**
 * Branded HTML email shell.
 *
 * Wraps a body (the photographer's message, which may be plain text or simple
 * HTML) in a clean, email-client-safe layout: centered card, sensible
 * typography, a prominent "View Gallery" button, and a small footer. Uses
 * table-based layout + inline styles because that's what email clients
 * (Gmail/Outlook/Apple Mail) reliably render.
 *
 * The composer can include a `{gallery_button}` token in the body; if present
 * it's replaced with the styled button. If absent, the button is appended after
 * the body when a galleryUrl is provided — so every gallery email gets a real
 * CTA, not just a bare link.
 */

const ACCENT = "#10b981"; // emerald accent
const INK = "#1c1917"; // stone-900
const MUTED = "#78716c"; // stone-500
const HAIRLINE = "#e7e5e4"; // stone-200
const WASH = "#fafaf9"; // stone-50

function galleryButton(url: string, label = "View Gallery"): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 4px;">
    <tr>
      <td align="center" bgcolor="${ACCENT}" style="border-radius:6px;">
        <a href="${url}"
           style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.02em;color:#ffffff;text-decoration:none;border-radius:6px;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

/**
 * The password card. Sits under the CTA because it's what you reach for AFTER
 * tapping through, and it has to survive Outlook — hence a table, a background
 * on the cell rather than a border-radius'd div, and letter-spaced monospace
 * so "rn" never reads as "m" when someone retypes it on a phone.
 */
function passwordCard(password: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 4px;">
    <tr>
      <td style="padding:16px 20px;background:${WASH};border:1px solid ${HAIRLINE};border-radius:8px;" align="center">
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:${MUTED};padding-bottom:8px;">
          Gallery Password
        </div>
        <div style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:19px;font-weight:600;letter-spacing:0.14em;color:${INK};word-break:break-all;">
          ${escapeHtml(password)}
        </div>
      </td>
    </tr>
  </table>`;
}

export interface EmailShellOptions {
  /** The photographer's message — plain text or simple HTML. */
  body: string;
  /** Gallery URL for the CTA button (and the {gallery_button} token). */
  galleryUrl?: string | null;
  /** Sender / studio name shown in the footer. */
  fromName?: string;
  /**
   * Event cover image — rendered as a full-bleed hero at the top of the card,
   * linked to the gallery. Must be a long-lived absolute URL (the
   * /api/gallery/[slug]/cover redirect), never a raw presigned URL.
   */
  coverImageUrl?: string | null;
  /** Event name — used as the hero image's alt text. */
  eventName?: string | null;
  /** CTA button label (defaults to "View Gallery"). */
  buttonLabel?: string;
  /**
   * Gallery password, rendered as a card under the CTA. Caller decides whether
   * to include it — this only renders what it's handed. Must come from the
   * server's own read of the event, never from the composer's payload.
   */
  password?: string | null;
}

export function renderEmailShell({
  body,
  galleryUrl,
  fromName,
  coverImageUrl,
  eventName,
  buttonLabel,
  password,
}: EmailShellOptions): string {
  // If the body looks like plain text (no tags), preserve its line breaks.
  const looksHtml = /<[a-z][\s\S]*>/i.test(body);
  let content = looksHtml ? body : body.replace(/\n/g, "<br/>");

  const button = galleryUrl ? galleryButton(galleryUrl, buttonLabel) : "";
  const credentials = password ? passwordCard(password) : "";

  // Replace an explicit {gallery_button} token; otherwise append the button.
  // The password rides immediately behind the button either way — a client who
  // scrolls past the CTA has already left the part of the email that matters.
  if (content.includes("{gallery_button}")) {
    content = content.replace(/\{gallery_button\}/g, button + credentials);
  } else {
    content += button + credentials;
  }

  const year = ""; // avoid Date in shared code paths; footer year is optional

  // Full-bleed hero at the top of the card. Wrapped in the gallery link so the
  // photo itself is a tap target. display:block kills the phantom baseline gap.
  const hero = coverImageUrl
    ? `
          <tr>
            <td>
              ${galleryUrl ? `<a href="${galleryUrl}" style="display:block;text-decoration:none;">` : ""}
                <img src="${coverImageUrl}" alt="${eventName ? escapeHtml(eventName) : "Gallery cover"}"
                     width="560" style="display:block;width:100%;height:auto;border:0;"/>
              ${galleryUrl ? "</a>" : ""}
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:10px;overflow:hidden;">${hero}
          <tr>
            <td style="padding:28px 36px 8px;">
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:${INK};letter-spacing:-0.01em;">
                ${fromName ? escapeHtml(fromName) : "Your Gallery"}
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 36px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${INK};">
              ${content}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 28px;border-top:1px solid ${HAIRLINE};font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${MUTED};">
              ${fromName ? escapeHtml(fromName) + " · " : ""}Delivered with Pixeltrunk${year}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
