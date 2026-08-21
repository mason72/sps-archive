import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";
import { deleteNote, patchNote, type NotePatch } from "@/lib/intel-notes/store";

/** One entry: edit its text, tags, pin, or home; or remove it and its bytes. */

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const body = (await request.json().catch(() => null)) as NotePatch | null;
    if (!body) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    const result = await patchNote(supabase, user!.id, id, body);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, note: result.note });
  } catch (err) {
    await reportSystemError("api.intel.notes.PATCH", err, { id });
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const gone = await deleteNote(supabase, user!.id, id);
    if (!gone) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("api.intel.notes.DELETE", err, { id });
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  }
}
