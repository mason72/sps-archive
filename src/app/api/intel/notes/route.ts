import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import { reportSystemError } from "@/lib/monitoring/report";
import {
  createNotes,
  listNotes,
  resolveNoteSubject,
  type NewNoteInput,
  type NoteScope,
} from "@/lib/intel-notes/store";

/**
 * Intel notes & BTS photos.
 *
 * INTERNAL — gated on Event Intel and scoped to the owner on every query. This
 * is venue logistics, client quirks and crew photos; there is no share path to
 * it and there must never be one.
 *
 *   GET  ?eventId= | ?venueId= | ?orgId=     one scope, pinned first, newest
 *   POST { eventId?, venueId?, orgId?, entries: [...] }   batch create
 *
 * The venue and client come FROM the event when an event is given and the
 * caller names neither — see `resolveNoteSubject`.
 */

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const sp = new URL(request.url).searchParams;
    const eventId = sp.get("eventId");
    const venueId = sp.get("venueId");
    const orgId = sp.get("orgId");
    let scope: NoteScope;
    if (eventId) scope = { eventId };
    else if (venueId) scope = { venueId };
    else if (orgId) scope = { orgId };
    else return NextResponse.json({ error: "eventId, venueId or orgId required" }, { status: 400 });

    const notes = await listNotes(supabase, user!.id, scope);
    return NextResponse.json({ notes });
  } catch (err) {
    await reportSystemError("api.intel.notes.GET", err);
    return NextResponse.json({ error: "Could not load notes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const body = (await request.json().catch(() => null)) as {
      eventId?: string | null;
      venueId?: string | null;
      orgId?: string | null;
      entries?: NewNoteInput[];
    } | null;
    if (!body || !Array.isArray(body.entries)) {
      return NextResponse.json({ error: "entries required" }, { status: 400 });
    }

    const subject = await resolveNoteSubject(supabase, user!.id, body);
    if ("error" in subject) return NextResponse.json({ error: subject.error }, { status: 400 });

    const result = await createNotes(supabase, user!.id, subject, body.entries);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, notes: result.notes, subject });
  } catch (err) {
    await reportSystemError("api.intel.notes.POST", err);
    return NextResponse.json({ error: "Could not save" }, { status: 500 });
  }
}
