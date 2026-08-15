import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import {
  confirmCrewPerson,
  findCrewInArchive,
  unconfirmCrewPerson,
} from "@/lib/crew-faces/match";
import { ownsCrew } from "@/lib/crew-faces/store";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * "Is this them?" — face clusters across the archive that look like this crew
 * member, from their reference set.
 *
 *   GET     ranked cluster suggestions (read-only; AI suggests)
 *   POST    { personId } — a human says yes (humans apply); teaches the set
 *   DELETE  { personId } — undo a confirmation
 *
 * Intel-gated: which galleries a crew member appears in is crew data.
 */

type Params = { params: Promise<{ crewId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const { crewId } = await params;
    if (!(await ownsCrew(supabase, user!.id, crewId))) {
      return NextResponse.json({ error: "Not on your roster." }, { status: 404 });
    }
    return NextResponse.json(await findCrewInArchive(supabase, { userId: user!.id, crewId }));
  } catch (err) {
    await reportSystemError("crew.matches.get", err, {});
    return NextResponse.json({ error: "Could not search the archive" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const { crewId } = await params;
    if (!(await ownsCrew(supabase, user!.id, crewId))) {
      return NextResponse.json({ error: "Not on your roster." }, { status: 404 });
    }
    const body = (await req.json().catch(() => null)) as { personId?: string } | null;
    if (!body?.personId) {
      return NextResponse.json({ error: "personId is required" }, { status: 400 });
    }
    const result = await confirmCrewPerson(supabase, {
      userId: user!.id,
      crewId,
      personId: body.personId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("crew.matches.post", err, {});
    return NextResponse.json({ error: "Could not confirm" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const { crewId } = await params;
    const body = (await req.json().catch(() => null)) as { personId?: string } | null;
    if (!body?.personId) {
      return NextResponse.json({ error: "personId is required" }, { status: 400 });
    }
    const result = await unconfirmCrewPerson(supabase, {
      userId: user!.id,
      crewId,
      personId: body.personId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    await reportSystemError("crew.matches.delete", err, {});
    return NextResponse.json({ error: "Could not remove" }, { status: 500 });
  }
}
