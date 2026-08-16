import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { getPresignedDownloadUrl, getThumbnailKey } from "@/lib/r2/client";
import { FaceRings, type PersonFaceGeometry } from "@/components/events/FaceOutline";

export const dynamic = "force-dynamic";

/**
 * /dev/face-rings — visual fixture for the face ring geometry.
 *
 * Renders REAL group shots twice — natural aspect (the compare pane) and the
 * square cover-top tile (the modal grids) — with rings from live bboxes, so
 * ring placement can be verified by eye against actual faces before the
 * feature ships. The cover-top remap is the part worth staring at: an overlay
 * computed on the uncropped frame but drawn over an object-cover crop is the
 * kind of wrong that looks right in code.
 *
 * Dev-gated like every /dev page: NODE_ENV, never VERCEL_ENV (which fails
 * open off-Vercel).
 */
export default async function FaceRingsFixture() {
  if (process.env.NODE_ENV !== "development") notFound();

  const supabase = createServiceClient();

  // A person known to have group shots (NASAI measured 13 for IngriQue Salt).
  const { data: person } = await supabase
    .from("persons")
    .select("id, name, event_id")
    .ilike("name", "%IngriQue Salt%")
    .limit(1)
    .maybeSingle();
  if (!person) return <p className="p-8">No fixture person found.</p>;

  type FaceRow = {
    id: string;
    image_id: string;
    bbox_x: number;
    bbox_y: number;
    bbox_w: number;
    bbox_h: number;
    images: { width: number | null; height: number | null; r2_key: string };
  };
  const { data: faceRows } = await supabase
    .from("faces")
    .select("id, image_id, bbox_x, bbox_y, bbox_w, bbox_h, images!inner(width, height, r2_key)")
    .eq("person_id", person.id)
    .order("id")
    .range(0, 999);
  const faces = (faceRows ?? []) as unknown as FaceRow[];

  // Keep only their group shots: 2+ faces in the frame.
  const withCounts = await Promise.all(
    [...new Set(faces.map((f) => f.image_id))].map(async (imageId) => {
      const { count } = await supabase
        .from("faces")
        .select("id", { count: "exact", head: true })
        .eq("image_id", imageId);
      return { imageId, count: count ?? 0 };
    })
  );
  const groupIds = new Set(withCounts.filter((c) => c.count >= 2).map((c) => c.imageId));
  // Landscape first: the two orientations exercise DIFFERENT cover-top crop
  // branches (sides crop vs bottom crops), and the pane only shows one row.
  const groupFaces = faces
    .filter((f) => groupIds.has(f.image_id))
    .sort(
      (a, b) =>
        (b.images.width ?? 0) / (b.images.height ?? 1) -
        (a.images.width ?? 0) / (a.images.height ?? 1)
    )
    .slice(0, 6);

  const cards = await Promise.all(
    groupFaces.map(async (f) => ({
      geometry: {
        faceId: f.id,
        imageId: f.image_id,
        bbox: { x: f.bbox_x, y: f.bbox_y, w: f.bbox_w, h: f.bbox_h },
        imageWidth: f.images.width,
        imageHeight: f.images.height,
      } satisfies PersonFaceGeometry,
      url: await getPresignedDownloadUrl(getThumbnailKey(f.images.r2_key), 3600),
    }))
  );

  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="font-editorial text-2xl text-stone-900">
        Face rings — {person.name}
      </h1>
      <p className="mt-1 text-[13px] text-stone-500">
        Each row is one group shot: natural fit beside the cover-top square tile.
        The ring must sit on {person.name}&apos;s face in BOTH.
      </p>
      <div className="mt-8 space-y-10">
        {cards.map(({ geometry, url }) => (
          <div key={geometry.faceId} className="flex items-start gap-8">
            <figure className="w-96">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="w-full bg-stone-100" />
                <FaceRings faces={[geometry]} fit="natural" />
              </div>
              <figcaption className="mt-1 text-[11px] text-stone-400">natural</figcaption>
            </figure>
            <figure className="w-48">
              <div className="relative aspect-square overflow-hidden bg-stone-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" className="h-full w-full object-cover object-top" />
                <FaceRings faces={[geometry]} fit="cover-top" />
              </div>
              <figcaption className="mt-1 text-[11px] text-stone-400">cover-top</figcaption>
            </figure>
          </div>
        ))}
      </div>
    </div>
  );
}
