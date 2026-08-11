/**
 * The link between a Pixeltrunk event and its SimplePhotoShare counterpart.
 *
 * ONE fact, ONE key, ONE writer: `events.settings.spsEventId`.
 *
 * This file exists because that fact was about to get two homes. `import.ts`
 * has written the FLAT `settings.spsEventId` since SPS import shipped, and
 * `/api/sps/enhancements/[eventId]` already reads it inline — but the
 * guest-list design note in `tasks/todo.md` specified a NESTED
 * `settings.sps.eventId`. Two sessions building against those two documents
 * would have produced events linked under one key and read under the other,
 * and the failure is silent: the guest list simply never auto-resolves for
 * exactly the events that were imported properly.
 *
 * **Never match on event NAME.** Names differ between the two systems by
 * routine practice, and they get renamed on both sides. More importantly the
 * payload behind this link is PII — guest names, emails and sign-in answers —
 * so a false positive doesn't mislabel a gallery, it hands one client another
 * client's guest list. An id is exact; a name is a guess.
 *
 * Dates are for RANKING a human's picker, never for deciding. And derive the
 * day from `images.taken_at` in LOCAL time, not `events.event_date`: the
 * hand-entered field is NULL on 7 of 19 live events, and `taken_at` is a
 * timestamp, so reading it as UTC shifts an evening shoot to the next day.
 */

/** Where the link came from, for the audit trail. */
export type SpsLinkSource = "sps-import" | "manual-link";

export interface SpsEventLink {
  /** The SPS event's id. The only field anything should key on. */
  eventId: string;
  /** The name SPS showed when the link was made. DISPLAY ONLY — never a key. */
  eventName?: string | null;
  linkedAt?: string | null;
  source?: SpsLinkSource;
}

type Settings = Record<string, unknown> | null | undefined;

/**
 * Read the link, tolerating the nested shape the old design note described.
 *
 * A tolerant reader with a single writer is the safe half of this pattern —
 * it costs nothing and it rescues any row a parallel session may already have
 * written nested. Delete the nested branch once a query confirms no row uses
 * it (as of 2026-08-11: 0 of 19 events used either shape).
 */
export function readSpsEventLink(settings: Settings): SpsEventLink | null {
  const s = (settings ?? {}) as Record<string, unknown>;

  const flat = typeof s.spsEventId === "string" ? s.spsEventId.trim() : "";
  const nested = (s.sps as { eventId?: unknown } | undefined)?.eventId;
  const nestedId = typeof nested === "string" ? nested.trim() : "";

  const eventId = flat || nestedId;
  if (!eventId) return null;

  const name = s.spsEventName;
  const linkedAt = s.spsLinkedAt;
  const source = s.source;

  return {
    eventId,
    eventName: typeof name === "string" && name.trim() ? name.trim() : null,
    linkedAt: typeof linkedAt === "string" ? linkedAt : null,
    source: source === "sps-import" || source === "manual-link" ? source : undefined,
  };
}

/** Convenience for the common case — just the id, or null. */
export function readSpsEventId(settings: Settings): string | null {
  return readSpsEventLink(settings)?.eventId ?? null;
}

/**
 * The settings fields to MERGE when linking. The one write shape.
 *
 * Returns a patch rather than writing, because callers differ: the importer
 * creates an event, a manual link updates one. Both must spread this into the
 * event's existing settings — never replace settings wholesale on an update,
 * or the cover, sharing and guestList keys go with it.
 */
export function spsEventLinkPatch(
  link: SpsEventLink & { linkedAt: string }
): Record<string, string | null> {
  return {
    spsEventId: link.eventId,
    spsEventName: link.eventName?.trim() || null,
    spsLinkedAt: link.linkedAt,
    source: link.source ?? "manual-link",
  };
}
