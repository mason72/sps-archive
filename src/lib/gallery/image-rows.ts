import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPagesInWaves } from "@/lib/supabase/paged";

/**
 * The columns a gallery payload is built from. One list for the guest route
 * and the owner's preview, which render through the same component.
 */
export const GALLERY_IMAGE_FIELDS =
  "id, r2_key, original_filename, parsed_name, width, height, aesthetic_score, taken_at, dominant_color, media_type, focal_x, focal_y, is_cover_upload";

const PAGE = 1000;

/**
 * Every displayable photo of an event, in the event's grid sort, for the
 * guest gallery and the owner's preview.
 *
 * An image is displayable once its thumbnail exists, NOT once the AI pipeline
 * finishes. processing_status tracks the AI step (CLIP/faces/aesthetic); when
 * that step fails or is skipped, the photo is still fully viewable. Gating on
 * processing_status='complete' silently hid every photo whose AI step failed,
 * dropping whole sections from client galleries.
 *
 * Pages IN PARALLEL: a loop that waits on each 1,000-row page before asking
 * for the next took 1.5 to 1.8 s on Webex One (lesson 199). A gallery under
 * 1,000 photos is still one round trip; a full first page asks for a count
 * and then every other page, four at a time. Complete only at a SHORT page,
 * so a photo added after the count is not lost. Each page ends its ORDER BY
 * on `id`: filename and capture time are not unique, and offset paging over
 * a non-unique order can repeat a photo on two pages and skip another. Throws
 * on any failed read: a short gallery is worse than an error page.
 *
 * `imageIds` narrows the read to a selection share's photos; the same narrowed
 * query feeds the count and every page, so they cannot filter differently.
 */
export async function readGalleryImageRows(
  supabase: SupabaseClient,
  opts: { eventId: string; gridSort?: string; imageIds?: string[] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const imagesQuery = (columns: string, options?: { count: "exact"; head: true }) => {
    let q = supabase
      .from("images")
      .select(columns, options)
      .eq("event_id", opts.eventId)
      .eq("thumbnail_generated", true);
    if (opts.imageIds) q = q.in("id", opts.imageIds);
    return q;
  };

  const page = (i: number) => {
    let q = imagesQuery(GALLERY_IMAGE_FIELDS);
    if (opts.gridSort === "filename") {
      q = q.order("original_filename", { ascending: true });
    } else if (opts.gridSort === "date-taken") {
      q = q.order("taken_at", { ascending: true, nullsFirst: false });
    } else {
      q = q.order("created_at", { ascending: true });
    }
    return q.order("id", { ascending: true }).range(i * PAGE, i * PAGE + PAGE - 1);
  };

  const first = await page(0);
  if (first.error) throw first.error;
  const pages: Awaited<ReturnType<typeof page>>[] = [first];
  if ((first.data ?? []).length === PAGE) {
    const counted = await imagesQuery("id", { count: "exact", head: true });
    if (counted.error) throw counted.error;
    const pageCount = Math.ceil((counted.count ?? 0) / PAGE);
    pages.push(...(await fetchPagesInWaves(page, 1, pageCount)));
    for (const res of pages) if (res.error) throw res.error;
    while ((pages[pages.length - 1].data ?? []).length === PAGE) {
      const next = await page(pages.length);
      if (next.error) throw next.error;
      pages.push(next);
    }
  }
  // A photo added between the count and the pages can shift one row onto the
  // next page; keep the first copy of any id.
  const seen = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pages.flatMap((res): any[] => {
    if (res.error) throw res.error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((res.data ?? []) as any[]).filter((row) =>
      seen.has(row.id) ? false : (seen.add(row.id), true)
    );
  });
}
