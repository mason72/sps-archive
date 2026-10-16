import type { SupabaseClient } from "@supabase/supabase-js";

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
 */
export async function loadSectionLinks(
  supabase: SupabaseClient,
  sectionIds: string[]
): Promise<SectionLink[]> {
  const out: SectionLink[] = [];
  if (!sectionIds.length) return out;
  const PAGE = 1000;
  for (let off = 0; ; off += PAGE) {
    const { data, error } = await supabase
      .from("section_images")
      .select("section_id, image_id")
      .in("section_id", sectionIds)
      .order("sort_order", { ascending: true })
      .order("section_id", { ascending: true })
      .order("image_id", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as SectionLink[]));
    if (!data || data.length < PAGE) break;
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
