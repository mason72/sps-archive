import type { SupabaseClient } from "@supabase/supabase-js";
import { isJobSceneKey, jobMissingFields, parseJobMeta } from "@/lib/site/jobs";

/**
 * "Fill this job": the crew's pick page for a TDP Work job (Mason, 2026-11-24).
 *
 * Mason sends a photographer one link per job, `/fill/<jobSectionId>`. It opens
 * the job's source client galleries (`job_meta.sources`), ranked, and the
 * photographer taps 6 to 12 photos to add. Adding is the ordinary zero-copy
 * link (`POST /api/images/transfer`, mode "copy"), so joining the job section
 * publishes exactly as Copy to... does: on a live job the photos are on the
 * site at once (Mason's call: "right away, I'll tidy after").
 *
 * The page is signed-in only (the team shares the info@ login, Mason's call),
 * and this module is the one owner check for all three fill routes: the
 * section must be a job section in a gallery the caller owns, and a source
 * gallery is reachable only when the job lists it AND the caller owns it.
 */

/** The photographer's target, shown on the page. Not a hard limit. */
export const FILL_TARGET = { min: 6, max: 12 } as const;

/** Ranked shortlist size: deep enough to choose from, short enough for a phone. */
export const FILL_SHORTLIST = 36;

/** "Show all" page size. */
export const FILL_PAGE = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FillSource {
  eventId: string;
  name: string;
  photoCount: number;
}

export interface FillJob {
  sectionId: string;
  name: string;
  workEventId: string;
  locked: boolean;
  /** Required job fields still empty (the site shows the job only without these). */
  missing: string[];
  /** Every image already in the job, from any source. */
  memberIds: string[];
  sources: FillSource[];
}

export type FillLoad =
  | { ok: true; job: FillJob }
  | { ok: false; status: 404; error: string };

export async function loadFillJob(
  supabase: SupabaseClient,
  userId: string,
  sectionId: string
): Promise<FillLoad> {
  const notFound = { ok: false as const, status: 404 as const, error: "Job not found" };
  // A malformed id is "not found", not a database error and a system alert.
  if (!UUID.test(sectionId)) return notFound;
  const { data: section, error } = await supabase
    .from("sections")
    .select("id, name, locked, site_scene_key, job_meta, event_id, events!event_id(user_id)")
    .eq("id", sectionId)
    .maybeSingle();
  if (error) throw error;
  const owner = (section?.events as { user_id?: string } | null)?.user_id;
  if (!section || owner !== userId || !isJobSceneKey(section.site_scene_key)) return notFound;

  const meta = parseJobMeta(section.job_meta);
  const sourceIds = [...new Set(meta.sources.map((s) => s.eventId))];

  const [members, sourceRows] = await Promise.all([
    supabase.from("section_images").select("image_id").eq("section_id", section.id).order("image_id"),
    sourceIds.length
      ? supabase.from("events").select("id, name").in("id", sourceIds).eq("user_id", userId)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ]);
  if (members.error) throw members.error;
  if (sourceRows.error) throw sourceRows.error;

  // Photo counts, one HEAD count per source (a job lists a handful at most).
  const named = new Map((sourceRows.data ?? []).map((e) => [e.id, e.name as string]));
  const sources: FillSource[] = [];
  for (const id of sourceIds) {
    const name = named.get(id);
    if (!name) continue; // not the caller's, or deleted: never reachable from here
    const { count, error: countError, status } = await supabase
      .from("images")
      .select("id", { count: "exact", head: true })
      .eq("event_id", id)
      .eq("is_cover_upload", false);
    if (countError) throw new Error(`photo count failed (${status}): ${countError.message}`);
    sources.push({ eventId: id, name, photoCount: count ?? 0 });
  }

  return {
    ok: true,
    job: {
      sectionId: section.id,
      name: section.name,
      workEventId: section.event_id,
      locked: !!section.locked,
      missing: jobMissingFields(meta),
      memberIds: (members.data ?? []).map((r) => r.image_id as string),
      sources,
    },
  };
}

/** The source a request names, if the job lists it; else null (a 404). */
export function pickSource(job: FillJob, sourceId: string | null): FillSource | null {
  if (!sourceId) return job.sources[0] ?? null;
  return job.sources.find((s) => s.eventId === sourceId) ?? null;
}
