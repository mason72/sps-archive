import type { createServiceClient } from "@/lib/supabase/server";
import { reportSystemError } from "@/lib/monitoring/report";
import { selfieSearchEnabled } from "@/types/event-settings";

type SupabaseDB = ReturnType<typeof createServiceClient>;

/**
 * Whether a gallery offers "Find my photos", decided in ONE place.
 *
 * Two conditions, both required: the owner has not switched it off
 * (`selfieSearchEnabled`, default on), and the gallery has at least one
 * detected face. The second was added 2026-10-28: product shoots with no
 * people (Cobalt Robotics, Newomics) showed the button, and every selfie a
 * guest took there came back "no photos found" after a GPU round trip that
 * could only ever answer that.
 *
 * Both gallery payloads (guest and owner preview), the guest selfie route and
 * the warm-up route read this, so a visible button always has an endpoint
 * that answers it and a hidden one never has an endpoint that spends money.
 *
 * A gallery whose AI indexing has not run yet has no faces either, so the
 * button appears once the 30-minute sweep has indexed it, which is also the
 * first moment a selfie could match anything.
 */
export async function selfieSearchAvailable(
  db: SupabaseDB,
  eventId: string,
  sharing: { selfieSearch?: boolean } | null | undefined
): Promise<boolean> {
  if (!selfieSearchEnabled(sharing)) return false;
  return eventHasFaces(db, eventId);
}

/**
 * Does any photo in this event have a detected face?
 *
 * Starts from `images` (indexed on event_id) and asks for the first row with
 * a face, so it stops at the first hit: measured 2–4 ms on the largest
 * gallery (34k photos), a faceless one and a fresh one (2026-10-28). Never
 * filter `faces` by an embedded `images.event_id` instead: that walks every
 * face in the archive (lesson, 2026-09-14).
 *
 * A failed read answers TRUE. Unknown is not "no faces": hiding the button on
 * a database hiccup would take the feature away from a gallery that has it,
 * while showing it wrongly costs one empty search.
 */
export async function eventHasFaces(db: SupabaseDB, eventId: string): Promise<boolean> {
  const { data, error } = await db
    .from("images")
    .select("id, faces!inner(id)")
    .eq("event_id", eventId)
    .limit(1);
  if (error) {
    await reportSystemError("faces.eventHasFaces", error, { eventId });
    return true;
  }
  return (data ?? []).length > 0;
}

/**
 * How long after a selfie-endpoint call the GPU container is assumed warm.
 * Modal reclaims it after 600 s idle (`scaledown_window` in
 * modal/ai_pipeline.py); 8 minutes leaves margin for the call's own length.
 */
export const DETECTOR_WARM_FOR_MS = 8 * 60 * 1000;

/**
 * Has anything hit the selfie endpoint recently enough that the container is
 * still up? Every call to it (guest search, crew tag, warm ping) writes an
 * `ai_embed_selfie` usage row, so the newest row is the clock. Indexed on
 * (kind, created_at).
 *
 * The row is written when a call FINISHES, so two warm pings inside one cold
 * start do not see each other; the route's per-instance guard covers that.
 */
export async function detectorRecentlyUsed(
  db: SupabaseDB,
  now: number = Date.now()
): Promise<boolean> {
  const since = new Date(now - DETECTOR_WARM_FOR_MS).toISOString();
  const { data, error } = await db
    .from("usage_events")
    .select("id")
    .eq("kind", "ai_embed_selfie")
    .gte("created_at", since)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}
