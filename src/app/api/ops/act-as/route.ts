import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";
import { ACT_AS_COOKIE, encodeActAs } from "@/lib/auth/impersonation";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/ops/act-as { userId } — start acting as another account (admin
 * only; see impersonation.ts). DELETE — return to your own identity.
 * The cookie is honored only while the REAL session stays an admin.
 */
export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = admin;

  try {
    const { userId } = await request.json();
    if (typeof userId !== "string" || !userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }
    if (userId === user.id) {
      return NextResponse.json({ error: "That's already you" }, { status: 400 });
    }

    const { data: target, error } =
      await supabase.auth.admin.getUserById(userId);
    if (error || !target?.user?.email) {
      return NextResponse.json({ error: "No such account" }, { status: 404 });
    }

    const cookieValue = encodeActAs(target.user.id, target.user.email);
    if (!cookieValue) {
      // No GALLERY_SESSION_SECRET — refuse rather than set an unsigned cookie.
      await reportSystemError(
        "ops.act-as",
        "GALLERY_SESSION_SECRET unset — cannot sign act-as cookie"
      );
      return NextResponse.json({ error: "Not configured" }, { status: 503 });
    }

    const res = NextResponse.json({ ok: true, actingAs: target.user.email });
    res.cookies.set(ACT_AS_COOKIE, cookieValue, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12, // half a day; re-enter from /ops when it lapses
    });
    return res;
  } catch (err) {
    await reportSystemError("ops.act-as", err, { userId: user.id });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE() {
  // No admin gate: clearing the cookie only ever narrows access, and a
  // demoted admin must still be able to shed a stale act-as.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACT_AS_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
