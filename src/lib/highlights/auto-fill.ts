/**
 * Highlights auto-fill — the "include a Highlights section" toggle on
 * "Sort into sections" (2026-09-24, migration 086).
 *
 * The toggle stores a count on the Highlights section. The picks usually can't
 * be chosen at that moment (AI indexing runs after the upload), so this fills
 * the section LATER, from the same generator the review uses, taking its top
 * N moments and each moment's best frame. Mason's call: the picks go live
 * without a review, and the review stays one click away (Re-run).
 *
 * Invariants:
 *   - It only ever writes a section the machine owns (`highlights_auto_count`
 *     set). A human Accept clears the count, and from then on this never
 *     touches the section again.
 *   - It never overwrites photos a human put there: a waiting section that is
 *     no longer empty at fill time means someone curated it by hand, so the
 *     request is dropped instead.
 *   - It waits for AI to be SETTLED, not merely indexed: face clustering runs
 *     ~10 minutes after the last index (debounced), and the generator's
 *     per-person coverage reads those clusters. A fill called by the cluster job
 *     skips the wait; the sweep's safety net requires 15 quiet minutes.
 *   - Its picks are not training data. direction.ts skips machine-owned
 *     sections, so the generator never learns from its own output.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isAiReady } from "@/lib/events/status";
import { AI_INDEX_MAX_ATTEMPTS } from "@/lib/ai-index/failures";
import { proposeHighlights } from "@/lib/highlights/propose";
import { CURATED_SECTION_NAME } from "@/lib/sections/intake";
import { MAX_HIGHLIGHTS, MIN_HIGHLIGHTS } from "@/lib/highlights/limits";

/** Longer than face clustering's 10-minute debounce. */
export const HIGHLIGHTS_SETTLE_MINUTES = 15;

export type AutoFillOutcome =
  | { status: "filled"; picks: number }
  | { status: "waiting"; reason: "indexing" | "settling" }
  | { status: "cancelled"; reason: "hand-curated" }
  | { status: "none" };

export function clampHighlightCount(n: unknown): number | null {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(MIN_HIGHLIGHTS, Math.min(MAX_HIGHLIGHTS, v));
}

/** Fill one event's waiting Highlights section, if it can be filled now. */
export async function fillPendingHighlights(
  supabase: SupabaseClient,
  eventId: string,
  opts: { skipSettle?: boolean } = {}
): Promise<AutoFillOutcome> {
  const { data: section, error: secErr } = await supabase
    .from("sections")
    .select("id, locked, highlights_auto_count, events!inner(user_id)")
    .eq("event_id", eventId)
    // Names are unique case-insensitively (migration 048), so match that way.
    .ilike("name", CURATED_SECTION_NAME)
    .not("highlights_auto_count", "is", null)
    .is("highlights_auto_filled_at", null)
    .maybeSingle();
  if (secErr) throw secErr;
  if (!section || section.locked) return { status: "none" };
  const ownerUserId = (section.events as unknown as { user_id: string }).user_id;
  const count = section.highlights_auto_count as number;

  const { data: readiness, error: rdErr } = await supabase.rpc("event_readiness", {
    p_event_ids: [eventId],
    p_max_attempts: AI_INDEX_MAX_ATTEMPTS,
  });
  if (rdErr) throw rdErr;
  const r = readiness?.[0];
  const ready =
    !!r &&
    isAiReady({
      total: Number(r.total),
      indexed: Number(r.indexed),
      uploading: Number(r.uploading),
      gaveUp: Number(r.gave_up ?? 0),
    });
  if (!ready) return { status: "waiting", reason: "indexing" };

  if (!opts.skipSettle) {
    const { data: newest, error: nErr } = await supabase
      .from("images")
      .select("ai_indexed_at")
      .eq("event_id", eventId)
      .not("ai_indexed_at", "is", null)
      .order("ai_indexed_at", { ascending: false })
      .limit(1);
    if (nErr) throw nErr;
    const last = newest?.[0]?.ai_indexed_at ? Date.parse(newest[0].ai_indexed_at) : 0;
    if (Date.now() - last < HIGHLIGHTS_SETTLE_MINUTES * 60_000) {
      return { status: "waiting", reason: "settling" };
    }
  }

  // Someone put photos here by hand while it waited: theirs wins.
  const { count: members, error: mErr } = await supabase
    .from("section_images")
    .select("image_id", { count: "exact", head: true })
    .eq("section_id", section.id);
  if (mErr) throw mErr;
  if ((members ?? 0) > 0) return handBack(supabase, section.id);

  const result = await proposeHighlights(supabase, eventId, ownerUserId, {
    count,
    coverage: true,
    poolExtra: 0,
  });
  const imageIds = result.proposals
    .slice(0, count)
    .map((p) => p.frames[p.chosenIndex]?.id ?? p.frames[0]?.id)
    .filter((id): id is string => !!id);

  // CLAIM, then write. The propose above can take minutes under load, and in
  // that window a person may Accept their own set (which clears the count) or
  // re-sort with a new count. The claim only succeeds if the section is still
  // exactly what we started from, so a lost race writes nothing. Claiming
  // first also makes a retry after success a no-op (filled_at is set), rather
  // than seeing our own picks and mistaking them for a person's.
  const { data: claimed, error: claimErr } = await supabase
    .from("sections")
    .update({ highlights_auto_filled_at: new Date().toISOString() })
    .eq("id", section.id)
    .eq("highlights_auto_count", count)
    .is("highlights_auto_filled_at", null)
    .select("id");
  if (claimErr) throw claimErr;
  if (!claimed?.length) return { status: "none" };

  // Photos dragged in by hand during the propose: theirs wins.
  const { count: nowMembers, error: nmErr } = await supabase
    .from("section_images")
    .select("image_id", { count: "exact", head: true })
    .eq("section_id", section.id);
  if (nmErr) throw nmErr;
  if ((nowMembers ?? 0) > 0) return handBack(supabase, section.id);

  if (imageIds.length) {
    const { error: insErr } = await supabase.from("section_images").insert(
      imageIds.map((image_id, i) => ({ section_id: section.id, image_id, sort_order: i + 1 }))
    );
    if (insErr) {
      // Release the claim so the next nudge tries again; never leave a
      // section stamped "filled" with nothing in it.
      await supabase
        .from("sections")
        .update({ highlights_auto_filled_at: null })
        .eq("id", section.id)
        .eq("highlights_auto_count", count);
      throw insErr;
    }
  }

  // A person accepting in the milliseconds between claim and insert would
  // leave our picks mixed into theirs. Too narrow to guard with a lock, so
  // detect it and say so rather than guess which rows are whose.
  const { data: after, error: afterErr } = await supabase
    .from("sections")
    .select("highlights_auto_count")
    .eq("id", section.id)
    .maybeSingle();
  if (afterErr) throw afterErr;
  if (after && after.highlights_auto_count === null) {
    const { reportSystemError } = await import("@/lib/monitoring/report");
    await reportSystemError(
      "highlights-auto-fill.race",
      new Error("a human Accept landed during the auto-fill insert"),
      { eventId, sectionId: section.id }
    );
  }
  return { status: "filled", picks: imageIds.length };
}

/** A person curated this section: stop managing it, keep their photos. */
async function handBack(supabase: SupabaseClient, sectionId: string): Promise<AutoFillOutcome> {
  const { error } = await supabase
    .from("sections")
    .update({ highlights_auto_count: null, highlights_auto_filled_at: null })
    .eq("id", sectionId);
  if (error) throw error;
  return { status: "cancelled", reason: "hand-curated" };
}

/** Events with a Highlights section still waiting to be filled. */
export async function eventsWithPendingHighlights(
  supabase: SupabaseClient,
  limit = 200
): Promise<string[]> {
  const { data, error } = await supabase
    .from("sections")
    .select("event_id")
    .ilike("name", CURATED_SECTION_NAME)
    .not("highlights_auto_count", "is", null)
    .is("highlights_auto_filled_at", null)
    // A locked section is never filled, so it must not hold a sweep slot.
    .eq("locked", false)
    // Oldest request first: FIFO, so a backlog cannot starve anyone.
    .order("created_at")
    .order("id")
    .limit(limit);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.event_id as string))];
}
