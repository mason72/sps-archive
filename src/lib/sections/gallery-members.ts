import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPagesInWaves } from "@/lib/supabase/paged";

/**
 * Two things every reader of "an event's photos" needs (lesson 184).
 *
 * 1. COVER UPLOADS ARE NOT PHOTOS. A cover uploaded from the Design tab posts
 *    with `skipSection`; it is an `images` row (usually a client logo) with a
 *    thumbnail and an AI index entry, marked `images.is_cover_upload` (migration
 *    096). Readers filter `.eq("is_cover_upload", false)` in the query, or with
 *    the helpers below when they hold ids rather than a query. Before the mark,
 *    a logo was picked as a Highlight, shown in the guest "All" tab, zipped,
 *    sorted into sections and carded on /people.
 *
 *    Deliberately a MARK and not "a row in no section": a real photo can lose
 *    its last section link to a bug, and inferring "logo" from that would hide
 *    it everywhere, silently. Marked, the failure is a logo that shows up.
 *
 * 2. SECTION LINKS, READ WHOLE. `loadSectionLinks` pages past the 1000-row cap
 *    in a total order (manual sort_order first) and THROWS on a failed page:
 *    a short link set drops photos out of their sections in a client's
 *    gallery. The routes' old inline loops broke out on error instead.
 */

export interface SectionLink {
  section_id: string;
  image_id: string;
}

/**
 * Every link of the given sections. Ordered by sort_order then the primary
 * key, so each section's ids arrive in the photographer's manual order and
 * paging is deterministic.
 *
 * Pages go out IN PARALLEL (lesson 199): when the first page comes back
 * full, a count says how many more there are and they are all asked for at
 * once. One page at a time was 1.46 s of a Webex One load (8,443 links);
 * now 0.45 s. The read is still complete only at a
 * SHORT page, never at the count: if links were added after the count, the
 * last page comes back full and the reader keeps going one page at a time.
 * A link that shifts onto a second page is kept once (its primary key).
 */
export async function loadSectionLinks(
  supabase: SupabaseClient,
  sectionIds: string[]
): Promise<SectionLink[]> {
  if (!sectionIds.length) return [];
  const PAGE = 1000;
  const page = (i: number) =>
    supabase
      .from("section_images")
      .select("section_id, image_id")
      .in("section_id", sectionIds)
      .order("sort_order", { ascending: true })
      .order("section_id", { ascending: true })
      .order("image_id", { ascending: true })
      .range(i * PAGE, i * PAGE + PAGE - 1);

  const first = await page(0);
  if (first.error) throw first.error;
  const results: Awaited<ReturnType<typeof page>>[] = [first];
  // Only a full first page needs a count: most galleries fit in one page, and
  // counting costs a round trip of its own (~100 ms, measured).
  if ((first.data ?? []).length === PAGE) {
    const counted = await supabase
      .from("section_images")
      .select("image_id", { count: "exact", head: true })
      .in("section_id", sectionIds);
    if (counted.error) throw counted.error;
    const pageCount = Math.ceil((counted.count ?? 0) / PAGE);
    results.push(...(await fetchPagesInWaves(page, 1, pageCount)));
    for (const r of results) if (r.error) throw r.error;
  }
  while ((results[results.length - 1].data ?? []).length === PAGE) {
    const next = await page(results.length);
    if (next.error) throw next.error;
    results.push(next);
  }

  const out: SectionLink[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const link of (r.data ?? []) as SectionLink[]) {
      const key = `${link.section_id}:${link.image_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

/** The cover uploads of one event (a handful at most). Throws on error. */
export async function eventCoverUploadIds(
  supabase: SupabaseClient,
  eventId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("images")
    .select("id")
    .eq("event_id", eventId)
    .eq("is_cover_upload", true);
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.id as string));
}

/**
 * Which of these ids are cover uploads. For readers holding a bounded id list
 * (search results, a client-supplied selection). Chunked to keep the filter
 * inside a URL; throws on error.
 */
export async function coverUploadIdsAmong(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Set<string>> {
  const out = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const { data, error } = await supabase
      .from("images")
      .select("id")
      .in("id", unique.slice(i, i + 200))
      .eq("is_cover_upload", true);
    if (error) throw error;
    for (const row of data ?? []) out.add(row.id as string);
  }
  return out;
}
