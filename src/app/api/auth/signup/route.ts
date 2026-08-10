import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/auth/signup
 *
 * Server-side signup gated by the allowed_signups table (managed from /ops).
 * Public Supabase signups are disabled at the project level, so this route's
 * admin.createUser call is the ONLY way an account gets created — and the
 * allowlist check below is the lock on that door. It fails closed: no
 * allowlist row, no account.
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

    // ─── Allowlist check (fails closed) ───
    const supabase = createServiceClient();
    const { data: invite, error: allowlistError } = await supabase
      .from("allowed_signups")
      .select("email")
      .eq("email", trimmedEmail)
      .maybeSingle();

    if (allowlistError) {
      await reportSystemError("auth.signup.allowlist", allowlistError, {
        email: trimmedEmail,
      });
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }

    if (!invite) {
      return NextResponse.json(
        {
          error:
            "Pixeltrunk is in private beta. Request an invite at hello@pixeltrunk.com",
        },
        { status: 403 }
      );
    }

    // ─── Create user via Supabase admin API ───
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

    // ─── Mark the invite as joined (best-effort; signup already succeeded) ───
    const { error: joinedError } = await supabase
      .from("allowed_signups")
      .update({ joined_at: new Date().toISOString() })
      .eq("email", trimmedEmail);
    if (joinedError) {
      await reportSystemError("auth.signup.mark-joined", joinedError, {
        email: trimmedEmail,
      });
    }

    // ─── Send notification email to admin ───
    const resendKey = process.env.RESEND_API_KEY;
    const notifyEmail = process.env.RESEND_FROM_EMAIL || "info@simplephotoshare.com";
    if (resendKey) {
      // Escape user-supplied values before dropping them into the admin email's
      // HTML — otherwise a signup name/email can inject markup into our inbox.
      const esc = (s: string) =>
        s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
<p><strong>Email:</strong> ${esc(trimmedEmail)}</p>
<p><strong>Name:</strong> ${esc(fullName?.trim() || "(not provided)")}</p>
<p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
        }),
      }).catch((e) => console.error("Signup notification email failed:", e));
    }

    return NextResponse.json({ user: data.user });
  } catch (err) {
    await reportSystemError("auth.signup", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
