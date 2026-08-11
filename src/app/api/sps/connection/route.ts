import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import {
  deleteSpsConnection,
  getSpsConnectionStatus,
  saveSpsToken,
} from "@/lib/sps-integration/connection";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * The photographer's SimplePhotoShare connection.
 *
 * GET    — masked status. Never the token.
 * POST   — store a pasted token, after proving it works against SPS.
 * DELETE — disconnect (deletes the row; we don't keep a credential we've stopped
 *          using).
 *
 * getAuthUser() hands back the SERVICE client, which bypasses RLS, so every
 * query here carries `.eq("user_id", …)` — the whole table is one row per user
 * and an unfiltered read would be every photographer's SPS credential (the
 * exact shape of lessons #2 and #14).
 */

/**
 * Credential WRITES refuse to run while an admin is acting as someone else.
 * Reading a masked prefix in a support session is harmless; installing or
 * removing a third-party credential in an account you are merely impersonating
 * is not, and it would be indistinguishable afterwards from the owner doing it.
 */
function blockedWhileActingAs(actingAs: boolean): NextResponse | null {
  if (!actingAs) return null;
  return NextResponse.json(
    { error: "Connections can only be changed by the account owner." },
    { status: 403 }
  );
}

export async function GET() {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    return NextResponse.json(await getSpsConnectionStatus(supabase, user!.id));
  } catch (error) {
    console.error("SPS connection status error:", error);
    await reportSystemError("sps.connection-status", error, {});
    return NextResponse.json(
      { error: "Could not read the connection" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError, actingAs } = await getAuthUser();
    if (authError) return authError;

    const blocked = blockedWhileActingAs(actingAs);
    if (blocked) return blocked;

    const body = (await request.json().catch(() => null)) as {
      token?: string;
    } | null;

    if (!body?.token || typeof body.token !== "string") {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    const result = await saveSpsToken(supabase, user!.id, body.token);

    if (!result.ok) {
      // 400 for a bad paste, 502 for SPS being unreachable — the photographer
      // can fix the first and can only wait out the second.
      return NextResponse.json(
        { error: result.message, reason: result.reason },
        { status: result.reason === "unreachable" ? 502 : 400 }
      );
    }

    return NextResponse.json({
      ...result.status,
      eventCount: result.eventCount,
    });
  } catch (error) {
    // Deliberately does not include the request body — it holds the token.
    console.error("SPS connection save error:", error);
    await reportSystemError("sps.connection-save", error, {});
    return NextResponse.json(
      { error: "Could not save the connection" },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const { user, supabase, error: authError, actingAs } = await getAuthUser();
    if (authError) return authError;

    const blocked = blockedWhileActingAs(actingAs);
    if (blocked) return blocked;

    await deleteSpsConnection(supabase, user!.id);
    return NextResponse.json({
      connected: false,
      tokenPrefix: null,
      connectedAt: null,
      lastPullAt: null,
    });
  } catch (error) {
    console.error("SPS connection delete error:", error);
    await reportSystemError("sps.connection-delete", error, {});
    return NextResponse.json(
      { error: "Could not disconnect" },
      { status: 500 }
    );
  }
}
