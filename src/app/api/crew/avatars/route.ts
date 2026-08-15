import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { crewAvatars } from "@/lib/crew-faces/store";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/crew/avatars?ids=a,b,c — one avatar per crew id, for lists.
 *
 * Batch on purpose: the Intel list shows 61 people, and 61 requests for 61
 * circles is how a page gets slow in a way nobody can point at. Ids the caller
 * does not own simply come back null — the store's user_id scope makes another
 * account's id indistinguishable from a person with no photos.
 */
export async function GET(req: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const ids = (new URL(req.url).searchParams.get("ids") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 200);
    if (!ids.length) return NextResponse.json({ avatars: {} });
    return NextResponse.json({ avatars: await crewAvatars(supabase, user!.id, ids) });
  } catch (err) {
    await reportSystemError("crew.avatars.get", err, {});
    return NextResponse.json({ error: "Could not load avatars" }, { status: 500 });
  }
}
