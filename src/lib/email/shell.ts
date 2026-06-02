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

function galleryButton(url: string): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 4px;">
    <tr>
      <td align="center" bgcolor="${ACCENT}" style="border-radius:6px;">
        <a href="${url}"
           style="display:inline-block;padding:14px 32px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;letter-spacing:0.02em;color:#ffffff;text-decoration:none;border-radius:6px;">
          View Gallery
        </a>
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
}

export function renderEmailShell({
  body,
  galleryUrl,
  fromName,
}: EmailShellOptions): string {
  // If the body looks like plain text (no tags), preserve its line breaks.
  const looksHtml = /<[a-z][\s\S]*>/i.test(body);
  let content = looksHtml ? body : body.replace(/\n/g, "<br/>");

  const button = galleryUrl ? galleryButton(galleryUrl) : "";

  // Replace an explicit {gallery_button} token; otherwise append the button.
  if (content.includes("{gallery_button}")) {
    content = content.replace(/\{gallery_button\}/g, button);
  } else if (button) {
    content += button;
  }

  const year = ""; // avoid Date in shared code paths; footer year is optional

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
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:10px;overflow:hidden;">
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
