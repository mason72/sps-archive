import { renderEmailShell } from "@/lib/email/shell";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * The alpha invite email — ONE home, used by the /ops invite panel and any
 * script that needs to (re)send an invite. Returns true when Resend accepted.
 */
export async function sendInviteEmail(to: string): Promise<boolean> {
  const resendKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://app.pixeltrunk.com";
  if (!resendKey) return false;

  const signupUrl = `${appUrl}/signup`;
  const body = `<p style="font-size:18px;font-weight:600;margin:0 0 12px;">You're in.</p>
<p>You've been invited to the Pixeltrunk alpha: an AI-powered archive for professional photographers. Semantic search across every shoot, face recognition that actually works, and galleries your clients will love.</p>
<p>Your email (<strong>${to}</strong>) is pre-approved. Create your account and start uploading:</p>
{gallery_button}
<p style="color:#78716c;font-size:13px;">It's alpha software, so if something looks weird, tell us. That's the job.</p>`;

  const html = renderEmailShell({
    body,
    galleryUrl: signupUrl,
    buttonLabel: "Create Your Account",
    fromName: "Pixeltrunk",
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `Pixeltrunk <${process.env.RESEND_FROM_EMAIL || "gallery@resend.dev"}>`,
      to: [to],
      subject: "Your Pixeltrunk alpha invite",
      html,
    }),
  });
  if (!res.ok) {
    void reportSystemError("ops.invites.email", await res.text(), { to });
    return false;
  }
  return true;
}
