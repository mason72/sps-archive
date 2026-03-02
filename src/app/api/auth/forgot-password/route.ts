import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { resetPasswordEmailHtml } from "@/lib/emails/reset-password-template";

/**
 * POST /api/auth/forgot-password
 *
 * Custom password reset flow:
 * 1. Generate a recovery token via Supabase admin API
 * 2. Build our own reset URL (bypasses Supabase's redirect chain)
 * 3. Send a branded email via Resend
 */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();
    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "";

    // Generate a recovery link (requires service role)
    const { data, error: linkError } = await supabase.auth.admin.generateLink({
      type: "recovery",
      email: email.trim(),
    });

    if (linkError) {
      console.error("Generate recovery link error:", linkError);
      // Don't reveal whether the email exists — always return success
      return NextResponse.json({ success: true });
    }

    const tokenHash = data.properties?.hashed_token;

    if (!tokenHash) {
      console.error("No hashed_token returned from generateLink");
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
    } else {
      // No Resend — log for development
      console.log("[dev] Password reset link:", resetUrl);
    }

    // Always return success (don't reveal if email exists)
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ success: true });
  }
}
