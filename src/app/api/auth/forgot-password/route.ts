import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resetPasswordEmailHtml } from "@/lib/emails/reset-password-template";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/auth/forgot-password
 *
 * Custom password reset flow:
 * 1. Generate a recovery token via Supabase admin API
 * 2. Build our own reset URL (bypasses Supabase's redirect chain)
 * 3. Send a branded email via Resend
 */
export async function POST(request: NextRequest) {
  // Apply a uniform floor latency so the response time doesn't reveal
  // whether the email exists. Supabase's generateLink returns fast for
  // unknown emails and slow (full lookup + Resend API call) for known
  // ones — without this floor, an attacker can time the difference and
  // enumerate which emails have accounts.
  const floor = new Promise<void>((resolve) => setTimeout(resolve, 600));

  try {
    // 5 reset requests / hour per IP — defeats email-bombing as well as
    // brute attempts to enumerate which emails exist via timing.
    const limit = rateLimit(`forgot:${clientIp(request)}`, 5, 60 * 60 * 1000);
    if (!limit.success) {
      // Return success anyway so we don't reveal the limit; the email
      // won't actually be sent.
      await floor;
      return NextResponse.json({ success: true });
    }

    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    // Only trust the configured app URL — never the request Origin header
    // (which an attacker can spoof to redirect the reset link to evil.com,
    // turning forgot-password into account takeover via token capture).
    const origin = process.env.NEXT_PUBLIC_APP_URL;
    if (!origin) {
      console.error(
        "[forgot-password] NEXT_PUBLIC_APP_URL is not set — refusing to send reset email"
      );
      return NextResponse.json({ success: true });
    }

    const supabase = createServiceClient();

    // Generate a recovery link (requires service role)
    const { data, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: email.trim(),
    });

    if (linkError) {
      console.error("Generate recovery link error:", linkError);
      // Don't reveal whether the email exists — always return success
      // (after the timing floor so the response isn't faster than the
      // happy-path one).
      await floor;
      return NextResponse.json({ success: true });
    }

    const tokenHash = data.properties?.hashed_token;

    if (!tokenHash) {
      console.error("No hashed_token returned from generateLink");
      await floor;
      return NextResponse.json({ success: true });
    }

    // Build our own reset URL — no Supabase redirect chain needed.
    // The reset-password page will verify this token directly via verifyOtp.
    const resetUrl = `${origin}/reset-password?token_hash=${tokenHash}&type=recovery`;

    // Send branded email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@pixeltrunk.com";

    if (resendKey) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Pixeltrunk <${fromEmail}>`,
          to: [email.trim()],
          subject: "Reset your password",
          html: resetPasswordEmailHtml(resetUrl, `${origin}/logo.png`),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error("Resend API error:", err);
      }
    } else if (process.env.NODE_ENV === "development") {
      // No Resend — log for local dev only. NEVER log the token in
      // production where logs may be collected (Vercel/CloudWatch/Datadog).
      console.log("[dev] Password reset link:", resetUrl);
    } else {
      console.error(
        "[forgot-password] RESEND_API_KEY is not set — reset email not delivered"
      );
    }

    // Always return success (don't reveal if email exists)
    await floor;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    await floor;
    return NextResponse.json({ success: true });
  }
}
