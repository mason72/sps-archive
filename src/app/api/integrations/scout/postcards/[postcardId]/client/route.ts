import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { isUuid } from "@/lib/scout-integration/validate";
import { scoutDb } from "@/lib/scout-integration/store";
import { placeInClientGallery, removeFromClientGallery } from "@/lib/scout-integration/client-bts";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";

/**
 * The CLIENT BTS BONUS (src/lib/scout-integration/client-bts.ts).
 *
 * PUT    { event_id }  copy the postcard into that client gallery's
 *                      "Behind the scenes" section. Idempotent; a different
 *                      event_id moves it. → { ok, event_id, section_id }
 * DELETE               take it out of whatever client gallery holds it.
 *                      Idempotent. → { removed }
 */
export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ postcardId: string }> };

export async function PUT(request: Request, ctx: Ctx) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const { postcardId } = await ctx.params;
  if (!isUuid(postcardId)) return NextResponse.json({ error: "postcard id must be a uuid." }, { status: 400 });

  let eventId: unknown;
  try {
    eventId = ((await request.json()) as { event_id?: unknown })?.event_id;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!isUuid(eventId)) return NextResponse.json({ error: "event_id must be a uuid." }, { status: 400 });
  try {
    return NextResponse.json(await placeInClientGallery(scoutDb(), postcardId.toLowerCase(), eventId.toLowerCase()));
  } catch (err) {
    return scoutErrorResponse(err, "scout.postcards.client.put", { postcardId, eventId });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const { postcardId } = await ctx.params;
  if (!isUuid(postcardId)) return NextResponse.json({ error: "postcard id must be a uuid." }, { status: 400 });
  try {
    return NextResponse.json(await removeFromClientGallery(scoutDb(), postcardId.toLowerCase()));
  } catch (err) {
    // A postcard Pixeltrunk never had is, for a removal, already removed.
    if (err && typeof err === "object" && "status" in err && (err as { status: number }).status === 404) {
      return NextResponse.json({ removed: false });
    }
    return scoutErrorResponse(err, "scout.postcards.client.delete", { postcardId });
  }
}
