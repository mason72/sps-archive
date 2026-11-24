import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { parsePostcardBody } from "@/lib/scout-integration/validate";
import { ingestPostcard, scoutDb } from "@/lib/scout-integration/store";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";

/**
 * POST /api/integrations/scout/postcards — archive one Scout postcard.
 *
 * Idempotent on `postcard_id`: a repeat returns the existing link (201 the
 * first time, 200 after). The fetch (30 s deadline, 40 MB cap), the R2 write
 * and the thumbnail render all happen inside this request; 120 s matches
 * /api/upload/complete, which also thumbnails a large original in-request.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const refused = requireScoutKey(request);
  if (refused) return refused;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = parsePostcardBody(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await ingestPostcard(scoutDb(), parsed.value);
    return NextResponse.json(
      {
        image_id: result.link.image_id,
        status: result.status,
        created: result.created,
        ai_index_requested: result.aiIndexRequested,
      },
      { status: result.created ? 201 : 200 }
    );
  } catch (err) {
    return scoutErrorResponse(err, "scout.postcards.post", { postcardId: parsed.value.postcardId });
  }
}
