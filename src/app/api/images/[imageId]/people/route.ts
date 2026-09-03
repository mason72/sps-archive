import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

/**
 * GET /api/images/[imageId]/people — who is in this frame?
 *
 * The bridge from a photo you are LOOKING at to the cluster panel where
 * identity actually gets decided. Naming, crew-linking and splitting all
 * already live on that panel (PeopleView); nothing here decides anything, it
 * only answers "which clusters does this frame belong to" so the caller can
 * open the right one. Keeping the decision in one place is the point — a
 * second tagging surface would be a second place for the crew-vs-guest rule
 * to drift.
 *
 * Returns one entry per DETECTED face, including faces with no cluster yet
 * (personId null), because "this face isn't clustered" is a real answer the
 * caller must be able to show rather than silently drop.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ imageId: string }> }
) {
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;
    const { imageId } = await params;

    // getAuthUser hands back the SERVICE client, which bypasses RLS — every
    // query it feeds carries an ownership filter. `images` has no user_id, so
    // ownership comes through the event. The FK hint is REQUIRED: images and
    // events are related twice (event_id up, cover_image_id back) and an
    // unhinted embed fails outright.
    const { data: faces, error } = await supabase
      .from("faces")
      .select(
        `id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, quality,
         images!inner(id, width, height, events!images_event_id_fkey!inner(user_id)),
         persons(id, name, face_count)`
      )
      .eq("image_id", imageId)
      .eq("images.events.user_id", user!.id);
    if (error) throw error;

    // The nested embed defeats the generated types' inference, so the row shape
    // is declared here rather than left implicitly `any`.
    interface FaceRow {
      id: string;
      person_id: string | null;
      bbox_x: number | null; bbox_y: number | null; bbox_w: number | null; bbox_h: number | null;
      quality: number | null;
      images: { width: number | null; height: number | null } | null;
      persons: { id: string; name: string | null; face_count: number | null } | null;
    }
    const rows = (faces ?? []) as unknown as FaceRow[];
    const personIds = [...new Set(rows.map((f) => f.person_id).filter(Boolean))] as string[];

    // Crew identity is a LINK, never persons.name — so a crew-linked cluster
    // looks unnamed until you ask crew_persons. Showing "unnamed" for someone
    // already on the roster would invite a duplicate tag.
    const crewByPerson: Record<string, string> = {};
    if (personIds.length) {
      const { data: links } = await supabase
        .from("crew_persons")
        .select("person_id, crew!inner(display_name)")
        .in("person_id", personIds)
        .eq("user_id", user!.id);
      for (const l of links ?? []) {
        const crew = l.crew as unknown as { display_name: string } | null;
        if (crew) crewByPerson[l.person_id as string] = crew.display_name;
      }
    }

    const image = rows[0]?.images as unknown as { width: number | null; height: number | null } | undefined;

    return NextResponse.json({
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
      faces: rows
        .map((f) => {
          const person = f.persons as unknown as { id: string; name: string | null; face_count: number | null } | null;
          return {
            faceId: f.id,
            personId: f.person_id,
            personName: person?.name ?? null,
            crewName: f.person_id ? crewByPerson[f.person_id] ?? null : null,
            photoCount: person?.face_count ?? null,
            quality: f.quality ?? 0,
            // Normalized fractions of the original frame, as the pipeline stores
            // them — the same geometry FaceOutline/FaceCircleCrop already expect.
            bbox: { x: f.bbox_x, y: f.bbox_y, w: f.bbox_w, h: f.bbox_h },
          };
        })
        // Left-to-right, so the picker reads in the order the faces appear.
        .sort((a, b) => (a.bbox.x ?? 0) - (b.bbox.x ?? 0)),
    });
  } catch (error) {
    await reportSystemError("images.people", error);
    return NextResponse.json({ error: "Failed to read the faces in this photo" }, { status: 500 });
  }
}
