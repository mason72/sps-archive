/**
 * Branded password reset email template for Pixeltrunk.
 *
 * Inline styles only — email clients don't support external CSS.
 * Stone palette + Inter-like system font stack for consistency.
 */
export function resetPasswordEmailHtml(resetLink: string, logoUrl?: string): string {
  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="Pixeltrunk" width="140" height="auto" style="display:block;margin:0 auto;max-width:140px;height:auto;" />`
    : `<span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;color:#1c1917;letter-spacing:-0.02em;">Pixeltrunk</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#fafaf9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fafaf9;padding:40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
          <!-- Logo -->
          <tr>
            <td style="padding-bottom:32px;text-align:center;">
              ${logoHtml}
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#ffffff;border:1px solid #e7e5e4;padding:40px 36px;">
              <h1 style="margin:0 0 8px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:400;color:#1c1917;line-height:1.2;">
                Reset your <em>password</em>
              </h1>
              <p style="margin:0 0 28px;font-size:14px;color:#78716c;line-height:1.5;">
                We received a request to reset your password. Click the button below to choose a new one.
              </p>

              <!-- Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                <tr>
                  <td style="background-color:#1c1917;padding:12px 32px;">
                    <a href="${resetLink}" target="_blank" style="font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:0.05em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
                      Reset Password
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;font-size:13px;color:#a8a29e;line-height:1.6;">
                If the button doesn&rsquo;t work, copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 28px;font-size:12px;color:#78716c;word-break:break-all;line-height:1.5;background-color:#fafaf9;padding:12px;border:1px solid #e7e5e4;">
                ${resetLink}
              </p>

              <p style="margin:0;font-size:13px;color:#a8a29e;line-height:1.5;">
                If you didn&rsquo;t request this, you can safely ignore this email. Your password won&rsquo;t change.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding-top:24px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#a8a29e;line-height:1.5;">
                &copy; Pixeltrunk &mdash; Intelligent Photo Archive
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
