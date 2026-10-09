import type { SpsRecap } from "./types";

/**
 * Oktane 2026 as SPS measured it on 2026-10-09 (read-only queries against
 * share_links, check_in_entries and images). Real numbers, so a test that
 * passes here passes on the thing a client will read. The hours are in
 * America/Los_Angeles; 59 galleries between 10 and 11 on the Thursday is the
 * busiest hour of the event. `measured` is 621, not 623: two links point at
 * frames that were later deleted, and a link you cannot time is not a
 * 0-second delivery.
 */
export const OKTANE_RECAP: SpsRecap = {
  version: 1,
  generatedAt: "2026-10-09T18:00:00.000Z",
  timezone: "America/Los_Angeles",
  eventName: "Oktane 2026",
  firstCapture: "2026-09-22T20:00:07.536Z",
  lastCapture: "2026-09-24T19:21:48.729Z",
  guestsCheckedIn: 704,
  photos: 5119,
  aiRenders: 0,
  linksSent: 762,
  recipients: 580,
  linksOpened: 601,
  totalOpens: 2325,
  lastFrameToSend: {
    medianSec: 45,
    p90Sec: 181,
    under60s: 394,
    under300s: 589,
    measured: 621,
  },
  hours: [
    { startsAt: "2026-09-22T13:00:00-07:00", sent: 2, opened: 2 },
    { startsAt: "2026-09-22T14:00:00-07:00", sent: 11, opened: 11 },
    { startsAt: "2026-09-22T15:00:00-07:00", sent: 29, opened: 25 },
    { startsAt: "2026-09-22T16:00:00-07:00", sent: 33, opened: 25 },
    { startsAt: "2026-09-22T17:00:00-07:00", sent: 32, opened: 24 },
    { startsAt: "2026-09-22T18:00:00-07:00", sent: 43, opened: 37 },
    { startsAt: "2026-09-22T19:00:00-07:00", sent: 16, opened: 13 },
    { startsAt: "2026-09-23T08:00:00-07:00", sent: 56, opened: 43 },
    { startsAt: "2026-09-23T09:00:00-07:00", sent: 34, opened: 29 },
    { startsAt: "2026-09-23T10:00:00-07:00", sent: 41, opened: 34 },
    { startsAt: "2026-09-23T11:00:00-07:00", sent: 44, opened: 34 },
    { startsAt: "2026-09-23T12:00:00-07:00", sent: 36, opened: 33 },
    { startsAt: "2026-09-23T13:00:00-07:00", sent: 47, opened: 32 },
    { startsAt: "2026-09-23T14:00:00-07:00", sent: 45, opened: 31 },
    { startsAt: "2026-09-23T15:00:00-07:00", sent: 41, opened: 34 },
    { startsAt: "2026-09-23T16:00:00-07:00", sent: 38, opened: 32 },
    { startsAt: "2026-09-23T17:00:00-07:00", sent: 7, opened: 5 },
    { startsAt: "2026-09-24T08:00:00-07:00", sent: 43, opened: 34 },
    { startsAt: "2026-09-24T09:00:00-07:00", sent: 34, opened: 28 },
    { startsAt: "2026-09-24T10:00:00-07:00", sent: 59, opened: 42 },
    { startsAt: "2026-09-24T11:00:00-07:00", sent: 49, opened: 36 },
    { startsAt: "2026-09-24T12:00:00-07:00", sent: 19, opened: 15 },
    // Re-sends after the event: real sends, so they count toward linksSent,
    // but the chart shows shooting days only (see buildHourChart).
    { startsAt: "2026-09-25T11:00:00-07:00", sent: 1, opened: 1 },
    { startsAt: "2026-09-28T17:00:00-07:00", sent: 2, opened: 1 },
  ],
};
