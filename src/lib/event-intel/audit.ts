import type { User } from "@supabase/supabase-js";

/**
 * Who is making this judgement — the one place the answer is spelled.
 *
 * Every write that changes what the roster CLAIMS about a person (regular or
 * not, the rehire ladder, archived, the notes, and the per-gig rating) carries
 * this stamp. The `crew_change_log` trigger (migration 073) copies it onto the
 * history row; a write that omits it still gets logged, as "unattributed".
 *
 * ── Why the stamp travels in the row instead of being read server-side ──
 *
 * The trigger cannot ask `auth.uid()`. Every Intel route holds the SERVICE
 * client — `getAuthUser()` hands it back deliberately, which is also why each
 * query needs its own `.eq("user_id", …)` — so no user JWT ever reaches the
 * connection, and PostgREST offers no transaction in which to set a session
 * variable. The actor has to be part of the UPDATE or it is not knowable.
 *
 * ── It is the REAL session, never the act-as identity ──
 *
 * This is the whole reason the log has any information in it. All 87 crew rows
 * belong to info@twodudesphoto.com, the shared team login, so the EFFECTIVE
 * user is a constant and recording it would answer "who marked him last resort"
 * with "the account that owns every row" — which is to say, nothing.
 *
 * `realUser` is the human who actually signed in. Mason acting as info@ records
 * mason@; somebody signed straight into the shared login records info@. That
 * gap is exactly the distinction worth having, and it matches the rule in
 * docs/OPS.md that anything admin-gated asks `realUser` rather than the
 * identity being impersonated.
 */
export type JudgementSource = "roster" | "event" | "apply-gig" | "script";

export interface ActorStamp {
  last_actor_id: string | null;
  last_actor_source: JudgementSource;
}

/**
 * Build the stamp from an auth result.
 *
 * Takes the whole `{ realUser }` shape rather than an id so a call site cannot
 * quietly hand over `user` (the effective identity) and get a log that looks
 * populated while saying nothing. Passing the wrong thing has to be deliberate.
 */
export function actorStamp(
  auth: { realUser: User | null },
  source: JudgementSource
): ActorStamp {
  return { last_actor_id: auth.realUser?.id ?? null, last_actor_source: source };
}

/** The fields whose changes are worth a history row. Mirrors the trigger. */
export const JUDGEMENT_FIELDS = [
  "is_regular",
  "rehire",
  "archived",
  "notes",
  "would_rebook",
  "note",
] as const;

/**
 * Does this patch change a judgement, or is it a plain correction?
 *
 * Used to keep the stamp off writes that only fix a spelling or a city. The
 * trigger already ignores those — nothing is logged when no watched field
 * moves — but stamping them would overwrite `last_actor_id` on the row with
 * whoever last edited an unrelated field, which makes that column misleading
 * for anyone who reads it directly instead of reading the log.
 */
export function touchesJudgement(patch: Record<string, unknown>): boolean {
  return JUDGEMENT_FIELDS.some((f) => f in patch);
}
