/**
 * What a pull went back for, and where those photos are filed now.
 *
 * A retried photo no longer lands in a visible "Unsorted" tab: it is filed
 * beside its person (pull-placement.ts), which on a 3,000-photo gallery means
 * it is correct and impossible to find. The import screen said "The import
 * brought every photo over" and nothing about where. This is the answer.
 *
 * ── Nothing is stored ──
 *
 * **Which photos:** the ones this job logged a failure for, whose row was
 * created AFTER its walk finished (`walked_at`). Both halves are needed. The
 * failure log nominates, as it does for the sweep itself: a pulled photo
 * moved in from ANOTHER import (a consolidation, a split into a private
 * gallery) also has a late creation date and never needed a second try. And
 * "after the walk" separates a photo the sweep fetched from one that failed
 * after its row was written and was simply finished later (four of AAOMS's
 * nine). Measured on all 17 finished imports on 2026-10-04: AAOMS 5, Grow
 * Therapy 1, the rest 0, which is exactly the photos that were recovered.
 *
 * **Where:** the photo's section links as they are NOW. A photo moved or
 * re-sorted since shows where it is, not where it first landed, which is the
 * useful answer and the reason this is read and not recorded.
 *
 * Highlights is left out when the photo is also filed somewhere else: a pick
 * in Highlights is a copy, and "Filed in Highlights and A–D" would send a
 * person to the wrong tab.
 */
import { isCuratedSectionName } from "@/lib/sections/intake";
import type { createServiceClient } from "@/lib/supabase/server";
import { readFailureLog } from "./pull-sweep";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/** Rows per read. PostgREST caps a response at 1,000. */
const ROW_PAGE = 1000;

/** Ids per `.in()` filter: the list travels in the query string. */
const ID_CHUNK = 100;

/** Filenames sent to the screen, across all groups. The counts are complete. */
export const RECOVERED_NAMES_SHOWN = 12;

export interface RecoveredGroup {
  /** The section's name ("A–D"), or null for a photo in no section. */
  section: string | null;
  /** Every recovered photo filed there. */
  count: number;
  /** The first few, by name. May be shorter than `count`. */
  filenames: string[];
}

export interface Recovered {
  total: number;
  /** In the gallery's own section order. */
  groups: RecoveredGroup[];
}

interface SectionInfo {
  id: string;
  name: string;
  sortOrder: number;
}

/**
 * Group recovered photos by where they are filed.
 *
 * `links` may name sections that are not in `sections` (another event's
 * section, for a photo also published to a website gallery): those are not
 * part of this gallery and are ignored.
 */
export function groupRecovered(
  rows: { id: string; filename: string }[],
  links: ReadonlyMap<string, string[]>,
  sections: ReadonlyMap<string, SectionInfo>
): Recovered {
  const groups = new Map<string, { section: string | null; order: number; filenames: string[] }>();

  for (const row of rows) {
    const here = [...new Set(links.get(row.id) ?? [])]
      .map((id) => sections.get(id))
      .filter((s): s is SectionInfo => !!s)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const filed = here.filter((s) => !isCuratedSectionName(s.name));
    // Only in Highlights: say so. It is the one place the photo can be found.
    const shown = filed.length ? filed : here;

    const section = shown.length ? shown.map((s) => s.name).join(" and ") : null;
    // By id, not by name: two sections can share a name and are still two tabs.
    const key = shown.map((s) => s.id).join("+");
    const group = groups.get(key) ?? {
      section,
      // A photo in no section sorts last: it is the one that needs attention.
      order: shown.length ? shown[0].sortOrder : Number.POSITIVE_INFINITY,
      filenames: [],
    };
    group.filenames.push(row.filename);
    groups.set(key, group);
  }

  const ordered = [...groups.values()].sort(
    (a, b) => a.order - b.order || (a.section ?? "").localeCompare(b.section ?? "")
  );

  let room = RECOVERED_NAMES_SHOWN;
  return {
    total: rows.length,
    groups: ordered.map((g) => {
      const names = [...g.filenames]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
        .slice(0, room);
      room -= names.length;
      return { section: g.section, count: g.filenames.length, filenames: names };
    }),
  };
}

/**
 * The photos this job went back for and got, grouped by section. Null when
 * there are none, or when the job has not finished a walk. A clean import has
 * an empty failure log and costs no read at all.
 *
 * The caller owns the authorization: `job` must be a row already read with the
 * caller's `user_id`. Every read here is scoped to that job's event.
 */
export async function loadRecovered(
  supabase: SupabaseDB,
  job: { event_id: string; walked_at: string | null; failures: unknown }
): Promise<Recovered | null> {
  if (!job.walked_at) return null;
  const nominated = readFailureLog(job.failures).map((f) => f.spsImageId);
  if (!nominated.length) return null;

  const rows: { id: string; filename: string }[] = [];
  for (let i = 0; i < nominated.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("images")
      .select("id, original_filename")
      .eq("event_id", job.event_id)
      .in("sps_image_id", nominated.slice(i, i + ID_CHUNK))
      .gt("created_at", job.walked_at);
    if (error) throw error;
    for (const r of data ?? []) rows.push({ id: r.id, filename: r.original_filename });
  }
  if (!rows.length) return null;

  const links = new Map<string, string[]>();
  for (let i = 0; i < rows.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("section_images")
      .select("image_id, section_id")
      .in(
        "image_id",
        rows.slice(i, i + ID_CHUNK).map((r) => r.id)
      );
    if (error) throw error;
    // A full response may be a cut one, and a cut one would file photos under
    // "no section". Say nothing rather than say that.
    if ((data ?? []).length >= ROW_PAGE) {
      throw new Error("section links for recovered photos hit the row cap");
    }
    for (const link of data ?? []) {
      const list = links.get(link.image_id);
      if (list) list.push(link.section_id);
      else links.set(link.image_id, [link.section_id]);
    }
  }

  // Only the sections those links name, and only this event's: a link into
  // another event's section never gets a name here.
  const sectionIds = [...new Set([...links.values()].flat())];
  const sections = new Map<string, SectionInfo>();
  for (let i = 0; i < sectionIds.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("sections")
      .select("id, name, sort_order")
      .eq("event_id", job.event_id)
      .in("id", sectionIds.slice(i, i + ID_CHUNK));
    if (error) throw error;
    for (const s of data ?? []) {
      sections.set(s.id, { id: s.id, name: s.name, sortOrder: s.sort_order });
    }
  }

  return groupRecovered(rows, links, sections);
}
