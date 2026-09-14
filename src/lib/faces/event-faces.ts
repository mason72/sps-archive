/**
 * Every face in one event, read event-first — the ONE home for that read.
 *
 * The obvious PostgREST shape, `faces.select("…, images!inner(…)")
 * .eq("images.event_id", id).order("id")`, compiles to a LATERAL subquery with
 * the event filter inside it. Postgres cannot start from the event there, so
 * it walks `faces_pkey` across the WHOLE archive and probes `images` once per
 * face to throw away other events' faces. Measured 2026-09-14 on Grow Therapy
 * Headshots (3,218 faces of 372,934): page one read 113,870 faces in 4.1s
 * cold, the last page read all 372,934, and the four pages together ran ~10s
 * on a quiet database — so one busy moment pushed a page past the 8s budget
 * and the People badge 500'd (lesson 144). The cost grew with the archive,
 * not the event, and the migration grows the archive every day.
 *
 * Here the event's images come from `idx_images_event_id` and its faces from
 * `idx_faces_image_id`, so the cost is the event's own size. Faces come back
 * sorted by id, the same order the old query returned, because clustering
 * consumes them in order.
 */
import type { createServiceClient } from "@/lib/supabase/server";

type SupabaseDB = ReturnType<typeof createServiceClient>;

const PAGE = 1000;
/** Image ids per `in` list — well inside PostgREST's URL limit (lesson on `.in()`). */
const ID_CHUNK = 200;
/** Chunks read at once. Bounded, so a 9,000-photo event is not a 46-request burst. */
const CONCURRENCY = 6;

export async function loadEventFaces<
  F extends { id: string; image_id: string },
  I extends { id: string },
>(
  supabase: SupabaseDB,
  eventId: string,
  opts: {
    /** Face columns; must include `id` and `image_id`. */
    faceColumns: string;
    /** Image columns; must include `id`. */
    imageColumns: string;
    /** Only faces that carry an embedding (clustering). */
    embeddedOnly?: boolean;
  }
): Promise<{ faces: F[]; imageById: Map<string, I> }> {
  const imageById = new Map<string, I>();
  // Paged reads ORDER BY a unique column, always (lesson 88).
  for (let page = 0; ; page++) {
    const { data, error } = await supabase
      .from("images")
      .select(opts.imageColumns)
      .eq("event_id", eventId)
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as I[];
    for (const row of rows) imageById.set(row.id, row);
    if (rows.length < PAGE) break;
  }

  const ids = [...imageById.keys()];
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) slices.push(ids.slice(i, i + ID_CHUNK));

  const byId = new Map<string, F>();
  let next = 0;
  const worker = async () => {
    while (next < slices.length) {
      const slice = slices[next++];
      // A chunk of group shots can exceed one page, and PostgREST truncates
      // at 1,000 rows without saying so — page within the chunk too.
      for (let page = 0; ; page++) {
        let query = supabase
          .from("faces")
          .select(opts.faceColumns)
          .in("image_id", slice);
        if (opts.embeddedOnly) query = query.not("embedding", "is", null);
        const { data, error } = await query
          .order("id")
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as unknown as F[];
        for (const row of rows) byId.set(row.id, row);
        if (rows.length < PAGE) break;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slices.length) }, worker));

  // uuid order in Postgres is byte order, which is lowercase-hex string order.
  const faces = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { faces, imageById };
}
