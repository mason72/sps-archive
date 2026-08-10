import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * GET /api/events/[eventId]/people
 *
 * The editor's People view: every clustered person in the event with their
 * representative face (bbox + a presigned thumb-lg of its image, so the
 * client renders a zoomed face crop) and the ids of every image they appear
 * in (drives filter-to-person in the grid). Ownership-scoped.
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
      .select("id")
      .eq("id", eventId)
      .eq("user_id", user!.id)
      .maybeSingle();
    if (!event) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const { data: persons, error: pErr } = await supabase
      .from("persons")
      .select("id, name, face_count, representative_face_id")
      .eq("event_id", eventId)
      .order("face_count", { ascending: false });
    if (pErr) throw pErr;
    if (!persons?.length) return NextResponse.json({ people: [] });

    // Every assigned face for the event: person → member images (paged).
    const memberImages = new Map<string, Set<string>>();
    const faceById = new Map<
      string,
      { imageId: string; bbox: { x: number; y: number; w: number; h: number } }
    >();
    for (let page = 0; ; page++) {
      const { data: rows, error } = await supabase
        .from("faces")
        .select("id, image_id, person_id, bbox_x, bbox_y, bbox_w, bbox_h, images!inner(event_id, r2_key, width, height)")
        .eq("images.event_id", eventId)
        .not("person_id", "is", null)
        .order("id", { ascending: true })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const row of rows ?? []) {
        const set = memberImages.get(row.person_id!) ?? new Set();
        set.add(row.image_id);
        memberImages.set(row.person_id!, set);
        faceById.set(row.id, {
          imageId: row.image_id,
          bbox: { x: row.bbox_x, y: row.bbox_y, w: row.bbox_w, h: row.bbox_h },
        });
      }
      if (!rows || rows.length < 1000) break;
    }

    // Representative-face images: presign one thumb-lg per person.
    const repImageIds = new Set<string>();
    for (const p of persons) {
      const rep = p.representative_face_id && faceById.get(p.representative_face_id);
      if (rep) repImageIds.add(rep.imageId);
    }
    const { data: repImages, error: iErr } = await supabase
      .from("images")
      .select("id, r2_key, width, height")
      .in("id", [...repImageIds]);
    if (iErr) throw iErr;
    const repById = new Map((repImages ?? []).map((i) => [i.id, i]));

    const people = await Promise.all(
      persons
        .filter((p) => (memberImages.get(p.id)?.size ?? 0) > 0)
        .map(async (p) => {
          const rep = p.representative_face_id
            ? faceById.get(p.representative_face_id)
            : undefined;
          const repImage = rep ? repById.get(rep.imageId) : undefined;
          return {
            id: p.id,
            name: p.name,
            faceCount: p.face_count,
            imageIds: [...(memberImages.get(p.id) ?? [])],
            face: rep && repImage
              ? {
                  thumbnailUrl: await getPresignedDownloadUrl(
                    getThumbnailKey(repImage.r2_key, "thumb-lg"),
                    14400
                  ),
                  bbox: rep.bbox,
                  imageWidth: repImage.width,
                  imageHeight: repImage.height,
                }
              : null,
          };
        })
    );

    return NextResponse.json({ people });
  } catch (error) {
    await reportSystemError("people.list", error, { eventId });
    return NextResponse.json({ error: "Failed to load people" }, { status: 500 });
  }
}
