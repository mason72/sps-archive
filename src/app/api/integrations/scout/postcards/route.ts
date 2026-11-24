import { NextResponse } from "next/server";
import { requireScoutKey } from "@/lib/scout-integration/auth";
import { parsePostcardBody } from "@/lib/scout-integration/validate";
import { ingestPostcard, scoutDb } from "@/lib/scout-integration/store";
import { scoutErrorResponse } from "@/lib/scout-integration/respond";

/**
 * POST /api/integrations/scout/postcards — archive one Scout postcard.
 *
 * Idempotent on `postcard_id`: a repeat returns the existing link (201 the
 * first time, 200 after). A photo: fetch (30 s deadline, 40 MB cap), R2 write
 * and thumbnails, all in this request. A clip (`media_type: "video"`): fetch
 * (60 s, 50 MB), then the Modal pipeline writes the SILENT copy and posters
 * (240 s deadline, cold start included) and the stored file is checked for an
 * audio track, all before answering; hence 300 s.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  // The clip path's time budget counts from HERE, not from wherever the store
  // happens to start its clock (store.ts pipelineTimeoutMs).
  const startedAt = Date.now();
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
    const result = await ingestPostcard(scoutDb(), parsed.value, { startedAt });
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
