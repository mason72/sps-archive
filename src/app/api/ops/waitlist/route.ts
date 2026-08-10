import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { sendInviteEmail } from "@/lib/emails/invite";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/ops/waitlist { email, action: "approve" | "dismiss" } — review a
 * waitlist application (admin only). Approving whitelists the address in
 * allowed_signups AND sends the branded invite; dismissing just marks the row
 * (kept for the record — a dismissed address can re-apply and be seen again).
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = admin;

  try {
    const { email, action } = await request.json();
    const trimmed = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!trimmed || !["approve", "dismiss"].includes(action)) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }

    const { data: row, error: readError } = await supabase
      .from("waitlist")
      .select("email, status")
      .eq("email", trimmed)
      .maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: "Not on the waitlist" }, { status: 404 });

    if (action === "dismiss") {
      const { error } = await supabase
        .from("waitlist")
        .update({ status: "dismissed", reviewed_at: new Date().toISOString() })
        .eq("email", trimmed);
      if (error) throw error;
      return NextResponse.json({ ok: true, status: "dismissed" });
    }

    // Approve: whitelist (idempotent) + branded invite + mark reviewed.
    const { error: allowError } = await supabase
      .from("allowed_signups")
      .upsert(
        { email: trimmed, invited_by: user.id, note: "waitlist approval" },
        { onConflict: "email", ignoreDuplicates: true }
      );
    if (allowError) throw allowError;

    const emailed = await sendInviteEmail(trimmed);

    const { error: markError } = await supabase
      .from("waitlist")
      .update({ status: "invited", reviewed_at: new Date().toISOString() })
      .eq("email", trimmed);
    if (markError) throw markError;

    return NextResponse.json({ ok: true, status: "invited", emailed });
  } catch (err) {
    await reportSystemError("ops.waitlist", err, { userId: user.id });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
