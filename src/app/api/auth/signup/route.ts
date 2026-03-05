import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/auth/signup
 *
 * Server-side signup with allowlist enforcement.
 * When ALLOWED_SIGNUP_EMAILS is set, only those emails can register.
 * When it's empty/unset, registration is open to everyone.
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password, fullName } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();

    // ─── Allowlist check ───
    const allowlist = process.env.ALLOWED_SIGNUP_EMAILS;
    if (allowlist) {
      const allowed = allowlist
        .split(",")
        .map((e: string) => e.trim().toLowerCase())
        .filter(Boolean);

      if (allowed.length > 0 && !allowed.includes(trimmedEmail)) {
        return NextResponse.json(
          {
            error:
              "Pixeltrunk is in private beta. Request an invite at hello@pixeltrunk.com",
          },
          { status: 403 }
        );
      }
    }

    // ─── Create user via Supabase admin API ───
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true, // Skip email verification for beta
      user_metadata: {
        full_name: fullName?.trim() || undefined,
      },
    });

    if (error) {
      // Map common Supabase errors to user-friendly messages
      if (error.message.includes("already been registered")) {
        return NextResponse.json(
          { error: "An account with this email already exists" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ─── Send notification email to admin ───
    const resendKey = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.RESEND_FROM_EMAIL || "info@simplephotoshare.com";
    if (resendKey) {
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `Pixeltrunk <${notifyEmail}>`,
          to: [notifyEmail],
          subject: `New signup: ${trimmedEmail}`,
          html: `<p>A new user just signed up for Pixeltrunk.</p>
<p><strong>Email:</strong> ${trimmedEmail}</p>
<p><strong>Name:</strong> ${fullName?.trim() || "(not provided)"}</p>
<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
        }),
      }).catch((e) => console.error("Signup notification email failed:", e));
    }

    return NextResponse.json({ user: data.user });
  } catch (err) {
    console.error("Signup error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
