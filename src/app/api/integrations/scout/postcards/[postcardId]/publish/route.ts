import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { SCOUT_PUBLISH_TARGETS, isScoutPublishTarget, isUuid } from "@/lib/scout-integration/validate";
import { publishPostcard, scoutDb, unpublishPostcard } from "@/lib/scout-integration/store";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";

/**
 * POST   { target }  put the postcard's photo in that website BTS scene
 * DELETE             take it off the scene it was published to
 *
 * Same mechanics as POST/DELETE /api/site/gallery: membership of the
 * `tdp-website` gallery's scene section IS publication (syncSitePublication),
 * which also sends the debounced TDP_SITE_REVALIDATE_URL ping.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ postcardId: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const { postcardId } = await ctx.params;
  if (!isUuid(postcardId)) return NextResponse.json({ error: "postcard id must be a uuid." }, { status: 400 });

  let target: unknown;
  try {
    target = ((await request.json()) as { target?: unknown })?.target;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!isScoutPublishTarget(target)) {
    return NextResponse.json(
      { error: `target must be one of: ${SCOUT_PUBLISH_TARGETS.join(", ")}` },
      { status: 400 }
    );
  }
  try {
    return NextResponse.json(await publishPostcard(scoutDb(), postcardId.toLowerCase(), target));
  } catch (err) {
    return scoutErrorResponse(err, "scout.postcards.publish", { postcardId, target });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const refused = requireScoutKey(request);
  if (refused) return refused;
  const { postcardId } = await ctx.params;
  if (!isUuid(postcardId)) return NextResponse.json({ error: "postcard id must be a uuid." }, { status: 400 });
  try {
    return NextResponse.json(await unpublishPostcard(scoutDb(), postcardId.toLowerCase()));
  } catch (err) {
    return scoutErrorResponse(err, "scout.postcards.unpublish", { postcardId });
  }
}
