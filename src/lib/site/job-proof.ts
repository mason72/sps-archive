/**
 * Job proof — the counted numbers behind a TDP Work case study
 * (twodudesphoto.com/work/<slug>): photos delivered, galleries, people, and
 * the "heartbeat" (photos per hour across each day on the floor).
 *
 * Counted from the client galleries linked to the job (`job_meta.sources`)
 * on every job save, and stored as `job_meta.proof`. Never typed by a person
 * and never accepted from a request body, so the site can say "counted".
 *
 * Two traps this encodes (found building /work, 2026-11-23):
 *   - Camera clocks travel on the wrong timezone (Electronica 2026 reads 2pm
 *     to midnight in Munich: the cameras stayed on US time). So the heartbeat
 *     is CLOCK-FREE: a "day" is a run of frames with no 4-hour gap, and each
 *     day's hours count from its own first frame. Never derive a time of day.
 *   - Faces are honest only for headshot-led galleries (Atlassian Expo 2026:
 *     7,747 photos, 111 people), so people are counted only from sources the
 *     editor marked, and are null when none is.
 *
 * Known limit (review, 2026-11-23): "clock-free" holds while every source
 * shares ONE clock error. Galleries whose cameras sat on different zones, or
 * rows ingested before 2026-09-24 (stored in the ingesting machine's zone,
 * docs/GOTCHAS.md), can split one real day in two or merge two into one.
 * Check the day count against the job's duration before publishing a story
 * that quotes it.
 */

import { readAllRows } from "@/lib/supabase/paged";
import { WORK_EVENT_SLUG, type JobProofMeta, type JobSource } from "./jobs";
import { WEBSITE_EVENT_SLUG } from "./gallery";

export const DAY_GAP_MS = 4 * 60 * 60 * 1000;
/** A run shorter than this is a stray (a test frame, a late upload), not a day. */
export const MIN_DAY_PHOTOS = 10;
export const MAX_DAY_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Split capture times into days (runs with no 4h+ gap) and bin each into
 * photos per hour from that day's first frame. Null when nothing qualifies.
 */
export function heartbeatDays(times: number[]): number[][] | null {
  const sorted = times.filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const days: number[][] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i === sorted.length || sorted[i] - sorted[i - 1] >= DAY_GAP_MS) {
      const run = sorted.slice(start, i);
      if (run.length >= MIN_DAY_PHOTOS) {
        const bins: number[] = [];
        for (const t of run) {
          const h = Math.floor((t - run[0]) / HOUR_MS);
          if (h >= MAX_DAY_HOURS) break; // sorted: everything after is later still
          while (bins.length <= h) bins.push(0);
          bins[h]++;
        }
        days.push(bins);
      }
      start = i;
    }
  }
  return days.length > 0 ? days : null;
}

export class JobProofError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** The slice of a Supabase client this module uses (the service client in routes). */
type Db = ReturnType<typeof import("@/lib/supabase/server").createServiceClient>;

/**
 * Count the proof for a job's sources. `userId` scopes every read: the route
 * runs on the service client, so ownership is this function's job (a source
 * id from another account is "not found", never counted).
 */
export async function computeJobProof(
  supabase: Db,
  userId: string,
  sources: JobSource[],
  now = new Date()
): Promise<JobProofMeta | null> {
  if (sources.length === 0) return null;
  const ids = sources.map((s) => s.eventId);

  const { data: owned, error: ownErr } = await supabase
    .from("events")
    .select("id, slug")
    .in("id", ids)
    .eq("user_id", userId);
  if (ownErr) throw new Error(`Source gallery lookup failed: ${ownErr.message}`);
  if ((owned ?? []).length !== ids.length) {
    throw new JobProofError("A source gallery was not found");
  }
  if ((owned ?? []).some((e) => e.slug === WORK_EVENT_SLUG || e.slug === WEBSITE_EVENT_SLUG)) {
    throw new JobProofError("The TDP Work and TDP Website galleries can't be a job's source");
  }

  // One read gives both the photo count and the capture times, so the two
  // numbers can never disagree about which photos exist.
  const rows = await readAllRows<{ id: string; taken_at: string | null }>(() =>
    // A gallery's uploaded cover (usually the client's logo) is an images row
    // too; it was counted as a photo until review caught it (lesson 184).
    supabase.from("images").select("id, taken_at").in("event_id", ids).eq("is_cover_upload", false)
  );

  const peopleIds = sources.filter((s) => s.people).map((s) => s.eventId);
  let people: number | null = null;
  if (peopleIds.length > 0) {
    const { count, error, status } = await supabase
      .from("persons")
      .select("id", { count: "exact", head: true })
      .in("event_id", peopleIds);
    // A HEAD count has no body: a failure reads { message: "" }, and a
    // bodiless answer reads count null. Neither may become "0 people".
    if (error || count === null) {
      throw new Error(`People count failed: HTTP ${status}${error?.message ? `, ${error.message}` : ""}`);
    }
    people = count;
  }

  const times = rows
    .map((r) => (r.taken_at ? Date.parse(r.taken_at) : NaN))
    .filter((t) => Number.isFinite(t));

  return {
    photos: rows.length,
    galleries: ids.length,
    people,
    days: heartbeatDays(times),
    countedAt: now.toISOString(),
  };
}
