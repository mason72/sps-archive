import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";
import { dismissedSetFrom, loadPeopleData, type FaceRef } from "@/lib/faces/people-data";

export const runtime = "nodejs";

/**
 * GET /api/events/[eventId]/people
 *
 * The editor's People view: every clustered person with their representative
 * face crop and member image ids, plus suggestions (mislabels carry a face
 * crop of the outlier so the photographer compares FACES, not names —
 * "we have no clue who these people are so the names don't mean very much").
 * Ownership-scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const { eventId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: event } = await supabase
      .from("events")
      .select("id, settings")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const data = await loadPeopleData(supabase, eventId, dismissedSetFrom(event.settings));

    // Crew links, so the wall can SAY "Christie Jones · crew" instead of
    // "Add name". Mason confirmed 22 Staff Photos clusters and the wall kept
    // rendering them as unidentified — a crew confirm deliberately never
    // writes persons.name, so without this map his completed work was
    // indistinguishable from work not done ("why didn't the confirmed names
    // carry over?!?!"). The link IS the identity; the wall must read it.
    const crewNameByPersonId = new Map<string, string>();
    {
      const personIds = data.persons.map((p) => p.id);
      for (let i = 0; i < personIds.length; i += 200) {
        const { data: links, error: linkErr } = await supabase
          .from("crew_persons")
          .select("person_id, crew!inner(display_name)")
          .eq("user_id", user!.id)
          .in("person_id", personIds.slice(i, i + 200));
        if (linkErr) throw linkErr;
        for (const l of links ?? []) {
          crewNameByPersonId.set(
            l.person_id,
            (l.crew as unknown as { display_name: string }).display_name
          );
        }
      }
    }

    const presignFace = async (ref: FaceRef | undefined) =>
      ref
        ? {
            thumbnailUrl: await getPresignedDownloadUrl(
              getThumbnailKey(ref.r2Key, "thumb-lg"),
              14400
            ),
            bbox: ref.bbox,
            imageWidth: ref.imageWidth,
            imageHeight: ref.imageHeight,
          }
        : null;

    const people = await Promise.all(
      data.persons
        .filter((p) => (data.memberImages.get(p.id)?.size ?? 0) > 0)
        .map(async (p) => ({
          id: p.id,
          name: p.name,
          crewName: crewNameByPersonId.get(p.id) ?? null,
          faceCount: p.face_count,
          imageIds: [...(data.memberImages.get(p.id) ?? [])],
          face: await presignFace(
            p.representative_face_id
              ? data.faceById.get(p.representative_face_id)
              : undefined
          ),
        }))
    );

    const mislabels = await Promise.all(
      data.suggestions.mislabels.map(async (s) => ({
        ...s,
        // The first outlier's face as clustered into the person — crop-ready
        // (the compare view shows every outlier full-frame via the grid map).
        face: await presignFace(
          data.personImageFace.get(`${s.personId}:${s.imageIds[0]}`)
        ),
      }))
    );

    const splits = await Promise.all(
      data.suggestions.splits.map(async (s) => ({
        ...s,
        groups: await Promise.all(
          s.groups.map(async (g) => ({
            ...g,
            face: await presignFace(
              data.personImageFace.get(`${s.personId}:${g.sampleImageId}`)
            ),
          }))
        ),
      }))
    );

    return NextResponse.json({
      people,
      suggestions: {
        mislabels,
        merges: data.suggestions.merges,
        refinements: data.suggestions.refinements,
        splits,
      },
    });
  } catch (error) {
    await reportSystemError("people.list", error, { eventId });
    return NextResponse.json({ error: "Failed to load people" }, { status: 500 });
  }
}
