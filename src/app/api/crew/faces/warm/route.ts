import { NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { warmFaceDetector } from "@/lib/crew-faces/store";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * POST /api/crew/faces/warm — wake the face detector before anyone needs it.
 *
 * The tag-at-import save runs on the Modal container that also indexes
 * events, and that container loads three models before it can answer: a cold
 * tag measured 23–44 seconds against 0.6–1.4 warm (usage ledger, 2026-08-31
 * and 2026-09-02). The import review fires this once when it opens, so the
 * models are loading while the photographer is still scrolling the grid.
 *
 * Intel-gated like every crew-faces route: only an account that can tag has
 * a reason to warm. AWAITED, not fire-and-forget — Vercel freezes a function
 * the moment it responds, and a request started without being awaited is
 * dropped with it. The browser does not wait; the route does.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  try {
    const { user, error: authError } = await getIntelUser();
    if (authError) return authError;
    const result = await warmFaceDetector(user!.id);
    return NextResponse.json(result);
  } catch (err) {
    await reportSystemError("crew.faces.warm", err, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
