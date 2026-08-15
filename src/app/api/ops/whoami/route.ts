import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/admin";

/**
 * "Should the Ops link be shown?" — nothing more.
 *
 * Client pages cannot read the session synchronously, and defaulting to "no"
 * is what made Ops vanish from six pages when the nav was unified. This answers
 * one boolean and leaks nothing: `requireAdmin` returns null for everyone else,
 * and every /ops page re-gates server-side regardless.
 */
export async function GET() {
  const admin = await requireAdmin();
  return NextResponse.json({ isAdmin: !!admin });
}
