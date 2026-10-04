/**
 * The pre-push live check's VERDICT, as a pure function.
 *
 * The check (`scripts/triage/live-activity.ts`) answers one question before a
 * push to main: would a deploy right now land on top of something happening?
 * Three things count, and each is named in the answer:
 *
 *  - people uploading to a real event,
 *  - a real event dated yesterday..tomorrow,
 *  - an SPS pull in flight (a deploy kills the step it is running).
 *
 * What does NOT count is the rows an SPS pull has ALREADY landed. Until
 * 2026-10-04 any new `images` row in a non-Pixieset event read as a live
 * upload, so the check said LIVE for six hours after every import or retry,
 * about an import that had finished. A gate that fires on its own side's
 * finished work gets waved through, and then it is waved through on the day
 * it is right. Pulled rows are counted and printed, on their own line, and
 * left out of the verdict (lesson 176).
 *
 * Which rows are "pulled" is decided in the script's query (`sps_image_id` is
 * set), and a row without one is an upload: the doubtful case reads as LIVE.
 *
 * Kept here, away from the script, so it can be tested: every way this can be
 * wrong is in the direction of "quiet".
 */

export interface LiveActivity {
  /** Events with rows in the window that a person uploaded. */
  uploads: { name: string; count: number }[];
  /** The upload read hit its row limit, so each count is a floor. */
  uploadsCapped?: boolean;
  /** Real events dated yesterday..tomorrow. */
  dated: { name: string; date: string }[];
  /** SPS pulls that are queued or running right now. */
  pullsInFlight: { name: string; status: string }[];
}

export function liveVerdict(activity: LiveActivity): { live: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (activity.uploads.length) {
    reasons.push(
      `uploads to ${activity.uploads.map((u) => `${u.name} (${u.count}${activity.uploadsCapped ? "+" : ""})`).join(", ")}`
    );
  }
  if (activity.dated.length) {
    reasons.push(
      `dated now: ${activity.dated.map((d) => `${d.name} (${d.date})`).join(", ")}`
    );
  }
  if (activity.pullsInFlight.length) {
    reasons.push(
      `SPS pull in flight: ${activity.pullsInFlight.map((p) => `${p.name} (${p.status})`).join(", ")}`
    );
  }
  return { live: reasons.length > 0, reasons };
}
