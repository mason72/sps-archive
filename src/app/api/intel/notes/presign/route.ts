import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";
import { MAX_NOTE_BATCH, presignNoteUploads } from "@/lib/intel-notes/store";

/**
 * Mint upload slots for BTS photos: one 2048px rendition and one 480px thumb
 * per photo, both made on the client, both PUT straight to R2.
 *
 * No row is created here. The row comes from POST /api/intel/notes AFTER both
 * PUTs return, and that route checks the objects exist — bytes before rows.
 */
export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getIntelUser();
    if (authError) return authError;
    const body = (await request.json().catch(() => ({}))) as { count?: number };
    const count = Math.floor(Number(body.count ?? 1));
    if (!Number.isFinite(count) || count < 1) return NextResponse.json({ error: "count required" }, { status: 400 });
    if (count > MAX_NOTE_BATCH) {
      return NextResponse.json({ error: `At most ${MAX_NOTE_BATCH} photos at a time` }, { status: 400 });
    }
    const slots = await presignNoteUploads(user!.id, count);
    return NextResponse.json({ slots });
  } catch (err) {
    await reportSystemError("api.intel.notes.presign", err);
    return NextResponse.json({ error: "Could not prepare upload" }, { status: 500 });
  }
}
