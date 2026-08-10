import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { sendInviteEmail } from "@/lib/emails/invite";
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

