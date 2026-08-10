/**
 * Relative time for share activity. Past a month a day count stops meaning
 * anything ("412d ago"), so fall back to the date itself.
 */
export function relativeTime(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Views counted before migration 039 have no timestamp — increment_share_views
 * bumped the counter without stamping the row. "Never" is only true at zero
 * views; anywhere else it contradicts the count printed beside it.
 */
export function lastViewedLabel(
  viewCount: number,
  lastViewedAt: string | null
): string {
  if (lastViewedAt) return relativeTime(lastViewedAt);
  return viewCount > 0 ? "Unknown" : "Never";
}
