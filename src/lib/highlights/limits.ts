/**
 * How many highlights the generator offers — ONE home, shared by the empty
 * state (which proposes a count) and the review (which re-thresholds it).
 * Two copies of these numbers is how the front door starts recommending a
 * count the review cannot reach.
 */

/** Ceiling on the slider. Above this a "highlights" reel is just the gallery. */
export const MAX_HIGHLIGHTS = 100;

/** Floor — fewer than this is a hand-pick, not a generated set. */
export const MIN_HIGHLIGHTS = 5;

/** Slider granularity. */
export const HIGHLIGHTS_STEP = 5;

/** Default ask when we have no reason to prefer another number. */
export const DEFAULT_HIGHLIGHTS = 40;

/**
 * The share of an event that real photographers keep, measured across the 12
 * events in this archive that already have hand-picked Highlights sections
 * (742 picks): median ~5%, full range 2.4%–17.9%. Used to phrase the
 * recommendation honestly rather than to hard-code a number.
 */
export const OBSERVED_KEEP_RANGE = [0.024, 0.179] as const;

/**
 * Suggested count for an event of `moments` captures.
 *
 * Defaults to DEFAULT_HIGHLIGHTS, but never proposes a "highlights" set that is
 * a large fraction of the event — 40 of 358 moments is a reel; 40 of 60 is the
 * gallery with a different name.
 */
export function suggestedHighlightCount(moments: number): number {
  if (moments <= 0) return MIN_HIGHLIGHTS;
  const quarter = Math.round((moments * 0.25) / HIGHLIGHTS_STEP) * HIGHLIGHTS_STEP;
  const capped = Math.min(DEFAULT_HIGHLIGHTS, Math.max(MIN_HIGHLIGHTS, quarter));
  return Math.min(capped, moments);
}

/** The observed keep-range expressed as counts for this event. */
export function typicalRangeFor(moments: number): [number, number] {
  return [
    Math.max(MIN_HIGHLIGHTS, Math.round(moments * OBSERVED_KEEP_RANGE[0])),
    Math.max(MIN_HIGHLIGHTS + 1, Math.round(moments * OBSERVED_KEEP_RANGE[1])),
  ];
}
