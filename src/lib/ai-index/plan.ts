/**
 * The AI lane's current plan: which galleries should be indexed now, in order.
 *
 * ONE definition, read by three places (lesson 175): the 30-minute sweep (who
 * to wake), every `ai-index` run as it starts (is this gallery's turn now?),
 * and a run that just finished a gallery (who is next). Before this, a run
 * indexed whatever gallery woke it and re-queued itself until done, so any
 * gallery that had ever been woken kept its place in the rotation and a new
 * priority order could not take effect for days.
 */
import type { createServiceClient } from "@/lib/supabase/server";
import {
  AI_INDEX_MAX_ATTEMPTS,
  AI_INDEX_RETRY_AFTER_MINUTES,
} from "@/lib/ai-index/failures";
import { PENDING_UPLOAD_STALE_MINUTES } from "@/lib/ai-index/index-event";
import { AI_SWEEP_CANDIDATES, planSweep, type SweepCandidate } from "@/lib/ai-index/sweep-plan";

type SupabaseDB = ReturnType<typeof createServiceClient>;

export type AiPlan =
  | { ok: true; eventIds: string[] }
  /** The queue could not be read. Callers decide what that means for them. */
  | { ok: false; error: unknown };

export async function loadAiPlan(
  supabase: SupabaseDB,
  candidates: number = AI_SWEEP_CANDIDATES
): Promise<AiPlan> {
  // The retry rules and the upload window are passed, not left to the SQL
  // defaults, so the queue and the batch select read one definition
  // (migration 082, lesson 151).
  const { data, error } = await supabase.rpc("events_needing_ai_index", {
    max_events: candidates,
    max_attempts: AI_INDEX_MAX_ATTEMPTS,
    retry_after_minutes: AI_INDEX_RETRY_AFTER_MINUTES,
    upload_stale_minutes: PENDING_UPLOAD_STALE_MINUTES,
  });
  if (error) return { ok: false, error };
  return { ok: true, eventIds: planSweep((data ?? []) as SweepCandidate[]) };
}

/**
 * A gallery indexed this recently has a live chain of runs: its last run
 * re-queued itself. Waking it again would add a second chain, and chains never
 * merge (the debounce only joins events inside its two-minute window). A
 * gallery that stays in the plan for hours would collect one more per sweep,
 * and a new gallery entering the plan would then get one turn in many instead
 * of its share. Thirty minutes is the sweep interval: a chain that died is
 * re-woken one sweep later at worst.
 */
export const AI_WAKE_QUIET_MINUTES = 30;

/**
 * The plan's galleries that need waking: the ones NOT indexed in the last
 * AI_WAKE_QUIET_MINUTES. Used by the sweep and by a run that just finished a
 * gallery. The gate in `ai-index` uses the whole plan, not this.
 *
 * If a gallery's recent activity cannot be read it is woken: an extra chain is
 * a slower lane, a gallery never woken is a stopped one.
 */
export async function loadAiWakeList(
  supabase: SupabaseDB,
  candidates: number = AI_SWEEP_CANDIDATES
): Promise<AiPlan> {
  const plan = await loadAiPlan(supabase, candidates);
  if (!plan.ok) return plan;
  const cutoff = new Date(Date.now() - AI_WAKE_QUIET_MINUTES * 60_000).toISOString();
  const quiet = await Promise.all(
    plan.eventIds.map(async (eventId) => {
      const { data, error } = await supabase
        .from("images")
        .select("id")
        .eq("event_id", eventId)
        .gt("ai_indexed_at", cutoff)
        .limit(1);
      return error || !data?.length;
    })
  );
  return { ok: true, eventIds: plan.eventIds.filter((_, i) => quiet[i]) };
}

