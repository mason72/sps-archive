/**
 * The delivery recap: what SimplePhotoShare knows about how an event's photos
 * reached its guests, snapshotted into the archive.
 *
 * Why a snapshot and not a live read: SPS deletes an event about three months
 * after it completes, and the recap is read for years (the share email, the
 * recap page, the next year's re-pitch). The archive keeps the only durable
 * copy, in `events.recap`, taken when the pull finishes and refreshable from
 * the share page while SPS still has the event.
 *
 * Why aggregates only: every number here is a count or a duration. No guest
 * name, email, phone or photo id crosses the wire. The guest list is a
 * separate, deliberately gated payload (see `guest-list/store.ts`).
 *
 * The SPS side implements this exact shape at
 * `GET /api/integrations/archive/events/[eventId]/recap`
 * (spsv2, `apps/admin/src/lib/archive-recap.ts`). Bump `version` when a field
 * changes meaning; `normalizeRecap` is the one reader.
 */

export const RECAP_VERSION = 1 as const;

export interface RecapHour {
  /** ISO timestamp of the hour's start, in the owner's timezone (offset kept). */
  startsAt: string;
  /** Galleries (share links) sent in this hour. */
  sent: number;
  /** Of those, how many were opened at least once (ever, not within the hour). */
  opened: number;
}

export interface RecapTiming {
  /** Seconds from a guest's LAST frame to their gallery leaving SPS. */
  medianSec: number | null;
  p90Sec: number | null;
  /** Links whose gallery left within 60 s / 300 s of the last frame. */
  under60s: number;
  under300s: number;
  /** Links the timing could be measured on (sent by email, with frames). */
  measured: number;
}

export interface SpsRecap {
  version: typeof RECAP_VERSION;
  /** When SPS computed it. */
  generatedAt: string;
  /** IANA zone the hours are bucketed in (the SPS owner's). */
  timezone: string;
  eventName: string;
  firstCapture: string | null;
  lastCapture: string | null;
  /** Check-in entries at the booth (a sit, not a person: a guest can sign in twice). */
  guestsCheckedIn: number;
  /**
   * People with any record of being served: sign-ins merged by email (else
   * name), plus everyone who received a gallery without signing in. This is
   * the number a client recognises from their guest list and the one every
   * surface leads with (WebexOne: 788 check-ins, 1,067 people).
   */
  guests: number;
  /** Camera frames (AI renders excluded). */
  photos: number;
  aiRenders: number;
  /** Share links sent (email + SMS). */
  linksSent: number;
  /** Distinct addresses those links went to. */
  recipients: number;
  /** Links opened at least once. */
  linksOpened: number;
  /** Sum of opens across all links. */
  totalOpens: number;
  lastFrameToSend: RecapTiming;
  /** Hour buckets with at least one send, ascending. */
  hours: RecapHour[];
}

/** What the archive stores beside the snapshot. */
export interface StoredRecap {
  recap: SpsRecap;
  /** When the archive fetched it (the column `recap_fetched_at` mirrors this). */
  fetchedAt: string;
}
