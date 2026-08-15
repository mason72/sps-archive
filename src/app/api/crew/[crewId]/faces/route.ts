import { NextRequest, NextResponse } from "next/server";
import { getIntelUser } from "@/lib/event-intel/require-intel";
import {
  addTaggedFace,
  addUploadedFace,
  crewFaceSet,
  deleteFaces,
  ownsCrew,
  setAvatar,
} from "@/lib/crew-faces/store";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * One crew member's reference faces.
 *
 *   GET     the drawable set, avatar first
 *   POST    add one — { faceId } tags an archive face, { imageBase64 } uploads
 *   PATCH   { faceRefId } — the star: make it the avatar
 *   DELETE  { faceRefId } one reference, or { all: true } the person's entire
 *           face record (references, uploads, cluster links) in one call
 *
 * Intel-gated (`getIntelUser`) because crew faces are crew data, and scoped by
 * user_id in the store regardless — the gate hides the feature, the filters
 * keep the data safe.
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
    return NextResponse.json({ faces: await crewFaceSet(supabase, user!.id, crewId) });
  } catch (err) {
    await reportSystemError("crew.faces.get", err, {});
    return NextResponse.json({ error: "Could not load faces" }, { status: 500 });
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

    const body = (await req.json().catch(() => null)) as {
      faceId?: string;
      imageBase64?: string;
    } | null;

    const result = body?.faceId
      ? await addTaggedFace(supabase, { userId: user!.id, crewId, faceId: body.faceId })
      : body?.imageBase64
        ? await addUploadedFace(supabase, {
            userId: user!.id,
            crewId,
            imageBase64: body.imageBase64,
          })
        : { ok: false as const, error: "faceId or imageBase64 is required" };

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({
      id: result.id,
      faces: await crewFaceSet(supabase, user!.id, crewId),
    });
  } catch (err) {
    await reportSystemError("crew.faces.post", err, {});
    return NextResponse.json({ error: "Could not add the face" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const { crewId } = await params;
    const body = (await req.json().catch(() => null)) as { faceRefId?: string } | null;
    if (!body?.faceRefId) {
      return NextResponse.json({ error: "faceRefId is required" }, { status: 400 });
    }
    const result = await setAvatar(supabase, {
      userId: user!.id,
      crewId,
      faceRefId: body.faceRefId,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ faces: await crewFaceSet(supabase, user!.id, crewId) });
  } catch (err) {
    await reportSystemError("crew.faces.patch", err, {});
    return NextResponse.json({ error: "Could not set the avatar" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { user, supabase, error: authError } = await getIntelUser();
    if (authError) return authError;
    const { crewId } = await params;
    const body = (await req.json().catch(() => null)) as {
      faceRefId?: string;
      all?: boolean;
    } | null;
    const result = await deleteFaces(supabase, {
      userId: user!.id,
      crewId,
      faceRefId: body?.faceRefId,
      all: !!body?.all,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ faces: await crewFaceSet(supabase, user!.id, crewId) });
  } catch (err) {
    await reportSystemError("crew.faces.delete", err, {});
    return NextResponse.json({ error: "Could not delete" }, { status: 500 });
  }
}
