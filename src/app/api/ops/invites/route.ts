import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { renderEmailShell } from "@/lib/email/shell";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * /api/ops/invites — alpha tester invites (admin only).
 *
 * POST { email, note?, sendEmail? } → whitelists the address in
 * allowed_signups and (by default) sends the branded invite. Re-POSTing an
 * existing invite re-sends the email without disturbing the row.
 * DELETE { email } → revokes an invite that hasn't been used (joined_at null).
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = admin;

  try {
    const { email, note, sendEmail = true } = await request.json();
    const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    }

    const { data: existing, error: readError } = await supabase
      .from("allowed_signups")
      .select("email, joined_at")
      .eq("email", trimmed)
      .maybeSingle();
    if (readError) throw readError;

    if (existing?.joined_at) {
      return NextResponse.json(
        { error: "That address already has an account" },
        { status: 409 }
      );
    }

    if (!existing) {
      const { error: insertError } = await supabase.from("allowed_signups").insert({
        email: trimmed,
        invited_by: user.id,
        note: typeof note === "string" && note.trim() ? note.trim() : null,
      });
      if (insertError) throw insertError;
    }

    let emailed = false;
    if (sendEmail) {
      emailed = await sendInviteEmail(trimmed);
    }

    return NextResponse.json({ ok: true, email: trimmed, emailed, resent: !!existing });
  } catch (err) {
    await reportSystemError("ops.invites.post", err, { userId: user.id });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = admin;

  try {
    const { email } = await request.json();
    const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    // Only unused invites are revocable — deleting a joined row would strand
    // a real account behind the signup gate's history.
    const { data: removed, error } = await supabase
      .from("allowed_signups")
      .delete()
      .eq("email", trimmed)
      .is("joined_at", null)
      .select("email");
    if (error) throw error;
    if (!removed?.length) {
      return NextResponse.json(
        { error: "No unused invite for that address" },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("ops.invites.delete", err, { userId: user.id });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

async function sendInviteEmail(to: string): Promise<boolean> {
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
