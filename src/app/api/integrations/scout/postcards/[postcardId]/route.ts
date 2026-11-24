import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { isUuid } from "@/lib/scout-integration/validate";
import { deletePostcard, postcardDetail, scoutDb } from "@/lib/scout-integration/store";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";

/**
 * GET    /api/integrations/scout/postcards/:postcardId  status, aesthetic score,
 *        and the CREW matched in the photo (never a guest). Read-only.
 * DELETE /api/integrations/scout/postcards/:postcardId  unpublish, then remove.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ postcardId: string }> };

async function postcardIdFrom(ctx: Ctx): Promise<string | null> {
  const { postcardId } = await ctx.params;
  return isUuid(postcardId) ? postcardId.toLowerCase() : null;
}

export async function GET(request: Request, ctx: Ctx) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const postcardId = await postcardIdFrom(ctx);
  if (!postcardId) return NextResponse.json({ error: "postcard id must be a uuid." }, { status: 400 });
  try {
    return NextResponse.json(await postcardDetail(scoutDb(), postcardId));
  } catch (err) {
    return scoutErrorResponse(err, "scout.postcards.get", { postcardId });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const postcardId = await postcardIdFrom(ctx);
  if (!postcardId) return NextResponse.json({ error: "postcard id must be a uuid." }, { status: 400 });
  try {
    return NextResponse.json(await deletePostcard(scoutDb(), postcardId));
  } catch (err) {
    return scoutErrorResponse(err, "scout.postcards.delete", { postcardId });
  }
}
