/**
 * A name that labels an EVENT is not a person, however person-shaped it is.
 *
 * Every file of a booth export parses to the job's name — "Google Booth",
 * 287 of 287 on Core SJC — and `looksLikePersonName` waves two capitalised
 * words through. Measured across the archive on 2026-09-02: 56 (event, name)
 * pairs where one name covers at least half of an event with 100+ photos,
 * and every one is a label — studio watermark tags ("2Dudes WF"), clients
 * ("Bay, Alarm", "IAEE", "Kinder"), venues ("Dolores", "Marathon"), and the
 * two that looked like people ("Haley Neil", "Mason, Tang") turned out to be
 * couples' and party names over 271 and 39 face clusters. Real single-person
 * sittings run 30–60 frames (the largest, "Nachi", is 48), never 100+.
 *
 * Judged PER EVENT: "Grace" may label one school's day and be a real Grace
 * at a headshot day. A dominant name loses only the event it dominates.
 * Faces were considered and rejected as the discriminator — a photographer
 * or host in many frames makes one cluster large on a label event too.
 */

/** A name covering fewer photos than this is never a label, whatever its share. */
export const EVENT_LABEL_MIN_COUNT = 100;
/** …and it must carry at least this share of the event's photos. */
export const EVENT_LABEL_MIN_SHARE = 0.5;

/**
 * `keyByRow`: each photo's (event, identity key). `totalByEvent`: how many
 * photos each event holds, named or not — the share is against the whole
 * event, or a set of unnamed camera frames would hide a label.
 * Returns eventId → keys that label that event.
 */
export function eventLabelKeys(
  keyByRow: Iterable<{ eventId: string; key: string }>,
  totalByEvent: ReadonlyMap<string, number>
): Map<string, Set<string>> {
  const counts = new Map<string, Map<string, number>>();
  for (const { eventId, key } of keyByRow) {
    const perEvent = counts.get(eventId) ?? new Map<string, number>();
    perEvent.set(key, (perEvent.get(key) ?? 0) + 1);
    counts.set(eventId, perEvent);
  }
  const labels = new Map<string, Set<string>>();
  for (const [eventId, perEvent] of counts) {
    const total = totalByEvent.get(eventId) ?? 0;
    if (total === 0) continue;
    for (const [key, n] of perEvent) {
      if (n >= EVENT_LABEL_MIN_COUNT && n / total >= EVENT_LABEL_MIN_SHARE) {
        const set = labels.get(eventId) ?? new Set<string>();
        set.add(key);
        labels.set(eventId, set);
      }
    }
  }
  return labels;
}
