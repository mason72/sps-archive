import { NextRequest, NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth/helpers";
import { reportSystemError } from "@/lib/monitoring/report";

export const runtime = "nodejs";

/**
 * GET /api/people/[personId]/faces — where this cluster's face sits in each of
 * its photos, plus which of those photos hold 2+ faces overall.
 *
 * Feeds the face ring in the review modals ("Is this X?", merge, split,
 * person). A confirm card showing a six-person frame without marking WHICH
 * face is being claimed invites a blind yes — Mason: "add an outline
 * box/circle on group shots … so it's clear who we're identifying as the
 * matched face." Geometry only: the modals already hold the thumbnails, so
 * nothing here is presigned.
 *
 * Ownership-scoped via person → event → user, same as the PATCH beside it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ personId: string }> }
) {
  const { personId } = await params;
  try {
    const { user, supabase, error: authError } = await getAuthUser();
    if (authError) return authError;

    const { data: person } = await supabase
      .from("persons")
      .select("id, events!inner(user_id)")
      .eq("id", personId)
      .maybeSingle();
    if (!person || (person.events as unknown as { user_id: string }).user_id !== user!.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // This cluster's faces. faces→images is a single FK (image_id), so no
    // relationship hint is needed — the ambiguity trap is images↔events.
    type FaceRow = {
      id: string;
      image_id: string;
      bbox_x: number;
      bbox_y: number;
      bbox_w: number;
      bbox_h: number;
      images: { width: number | null; height: number | null };
    };
    const faces: FaceRow[] = [];
    for (let page = 0; ; page++) {
      const { data, error } = await supabase
        .from("faces")
        .select("id, image_id, bbox_x, bbox_y, bbox_w, bbox_h, images!inner(width, height)")
        .eq("person_id", personId)
        // Paged reads ORDER BY, always (lesson 88).
        .order("id")
        .range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      faces.push(...((data ?? []) as unknown as FaceRow[]));
      if (!data || data.length < 1000) break;
    }

    // Which of those images hold 2+ faces from ANYONE — the ring only renders
    // on group shots, so solo portraits stay clean.
    const imageIds = [...new Set(faces.map((f) => f.image_id))];
    const faceTotals = new Map<string, number>();
    for (let i = 0; i < imageIds.length; i += 200) {
      const slice = imageIds.slice(i, i + 200);
      for (let page = 0; ; page++) {
        const { data, error } = await supabase
          .from("faces")
          .select("image_id")
          .in("image_id", slice)
          .order("id")
          .range(page * 1000, page * 1000 + 999);
        if (error) throw error;
        for (const f of data ?? []) {
          faceTotals.set(f.image_id, (faceTotals.get(f.image_id) ?? 0) + 1);
        }
        if (!data || data.length < 1000) break;
      }
    }

    return NextResponse.json({
      faces: faces.map((f) => ({
        faceId: f.id,
        imageId: f.image_id,
        bbox: { x: f.bbox_x, y: f.bbox_y, w: f.bbox_w, h: f.bbox_h },
        imageWidth: f.images.width,
        imageHeight: f.images.height,
      })),
      multiFaceImageIds: imageIds.filter((id) => (faceTotals.get(id) ?? 0) >= 2),
    });
  } catch (error) {
    await reportSystemError("people.faces", error, { personId });
    return NextResponse.json({ error: "Failed to load face geometry" }, { status: 500 });
  }
}
