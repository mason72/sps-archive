/**
 * Branded client-gallery email wrapper.
 *
 * Wraps the photographer-composed body HTML in the same branded chrome
 * that the EmailPreview right-rail shows — so the preview matches what
 * the client actually receives. Built as a single inline-styled
 * <table> hierarchy because email clients still don't reliably support
 * external CSS, classes, or even <style> tags.
 *
 * Mirrors the layout of `reset-password-template.ts` (logo → card →
 * footer) so internal + external emails feel like the same brand.
 */

interface Args {
  /** Photographer-composed HTML body (from TipTap). Should contain its
   *  own `<p>`/anchors etc.; we don't sanitize here — the editor scope
   *  + server-side template enforcement is the safety boundary. */
  bodyHtml: string;
  /** Photographer's business or display name. Shown in the header and
   *  used in the footer signature. */
  businessName: string;
  /** Photographer's branded accent color (hex). Used for the link rule
   *  and the small accent bar at the top of the card. */
  accentColor?: string;
  /** Optional logo URL (already presigned/public). When absent, the
   *  header shows the business name as serif text. */
  logoUrl?: string | null;
  /** Optional photographer website to link from the footer. */
  website?: string | null;
}

const FALLBACK_ACCENT = "#10b981";

function escapeAttr(v: string): string {
  return v.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function clientGalleryEmailHtml({
  bodyHtml,
  businessName,
  accentColor = FALLBACK_ACCENT,
  logoUrl,
  website,
}: Args): string {
  const accent = accentColor && /^#[0-9A-Fa-f]{3,8}$/.test(accentColor)
    ? accentColor
    : FALLBACK_ACCENT;

  const safeBusinessName = businessName.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const logoBlock = logoUrl
    ? `<img src="${escapeAttr(logoUrl)}" alt="${escapeAttr(safeBusinessName)}" width="140" height="auto" style="display:block;margin:0 auto;max-width:140px;height:auto;" />`
    : `<span style="font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:600;color:#1c1917;letter-spacing:-0.02em;">${safeBusinessName}</span>`;

  const websiteFooter = website
    ? `<p style="margin:0 0 6px;font-size:11px;color:#a8a29e;line-height:1.5;">
         <a href="${escapeAttr(website)}" style="color:#78716c;text-decoration:none;">${escapeAttr(website.replace(/^https?:\/\//, ""))}</a>
       </p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeBusinessName}</title>
</head>
<body style="margin:0;padding:0;background-color:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafaf9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="max-width:540px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="padding-bottom:24px;text-align:center;">${logoBlock}</td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border:1px solid #e7e5e4;border-top:3px solid ${accent};padding:36px 36px 32px;">
              <div style="font-size:15px;color:#1c1917;line-height:1.7;">
                ${bodyHtml}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:20px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:#78716c;line-height:1.5;font-style:italic;font-family:Georgia,'Times New Roman',serif;">
                ${safeBusinessName}
              </p>
              ${websiteFooter}
              <p style="margin:10px 0 0;font-size:10px;color:#d6d3d1;letter-spacing:0.12em;text-transform:uppercase;line-height:1.5;">
                Sent with Pixeltrunk
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
