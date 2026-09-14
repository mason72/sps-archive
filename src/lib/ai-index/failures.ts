/**
 * Per-image AI-index failure rules (migration 082, lesson 151). Pure — no R2,
 * no Modal, no Supabase client — so the rules are testable on their own.
 *
 * The problem this closes: an image Modal reports in `errors` never gets
 * `ai_indexed_at`, so before 082 its event was nudged on every 30-minute sweep
 * and the SAME first 100 ids went back to paid Modal each pass, forever. A
 * batch where all 100 failed also hid every image after them.
 *
 * Why retry at all instead of giving up on the first failure: measured
 * 2026-09-14, all 34 per-image failures in 30 days (6 of 2,027 batches) indexed
 * on a later pass. They were thumbnail-fetch blips, not bad files. So an image
 * gets AI_INDEX_MAX_ATTEMPTS tries spaced by a cool-down, then is left alone
 * and reported.
 *
 * These constants are the ONE home: the batch select reads them here, and the
 * sweep passes them to `events_needing_ai_index`, whose SQL defaults are only
 * a fallback for an old caller.
 */

/** Tries before an image is left alone. 3 × 60 min rides out any real blip. */
export const AI_INDEX_MAX_ATTEMPTS = 3;

/** Minimum gap before a failed image is offered to Modal again. */
export const AI_INDEX_RETRY_AFTER_MINUTES = 60;

/**
 * PostgREST `.or()` filter for "eligible to send to Modal now". Must match
 * the predicate in `events_needing_ai_index` (migration 082), or the sweep
 * nudges events whose batch select then finds nothing (harmless but noisy) —
 * or worse, the reverse, where eligible work is never nudged.
 */
export function aiIndexEligibleFilter(now: Date = new Date()): string {
  const cutoff = new Date(
    now.getTime() - AI_INDEX_RETRY_AFTER_MINUTES * 60 * 1000
  ).toISOString();
  return (
    `ai_index_attempts.eq.0,` +
    `and(ai_index_attempts.lt.${AI_INDEX_MAX_ATTEMPTS},ai_index_failed_at.lt.${cutoff})`
  );
}

/**
 * Which images in a batch failed, with a message for each.
 *
 * Two sources: ids Modal put in `errors`, and ids Modal returned in NEITHER
 * map. The second is not hypothetical — `index_images` silently `continue`s
 * past an item with a missing id or url — and an id that vanishes without a
 * failure record would be re-sent forever, the exact loop this exists to stop.
 * An id in `results` is a success even if it also appears in `errors`.
 */
export function batchFailures(
  batchIds: string[],
  out: { results: Record<string, unknown>; errors: Record<string, string> }
): { ids: string[]; messages: string[] } {
  const ids: string[] = [];
  const messages: string[] = [];
  for (const id of batchIds) {
    if (id in out.results) continue;
    ids.push(id);
    messages.push(redactUrlQueries(out.errors[id] ?? "missing from Modal response"));
  }
  return { ids, messages };
}

/**
 * Drop query strings from any URL in a message. Modal's fetch errors come from
 * httpx `raise_for_status`, which prints the full request URL, and that URL is
 * a presigned R2 link carrying X-Amz-Credential and X-Amz-Signature. The
 * message is stored in `images.ai_index_error` and mailed in the gave-up
 * report, so the signature must never reach either. The path stays: it names
 * the object, which is the useful part.
 */
export function redactUrlQueries(message: string): string {
  return message.replace(/(https?:\/\/[^\s'"?]+)\?[^\s'"]*/g, "$1?[redacted]");
}
