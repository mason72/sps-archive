import { describe, it, expect } from "vitest";
import {
  normalizeRecap,
  recapPassesFloor,
  recapOpenRate,
  formatSeconds,
  recapDays,
} from "./normalize";
import { OKTANE_RECAP } from "./fixtures";

describe("normalizeRecap", () => {
  it("round-trips the Oktane fixture", () => {
    const r = normalizeRecap(OKTANE_RECAP);
    expect(r).not.toBeNull();
    expect(r!.guestsCheckedIn).toBe(704);
    expect(r!.linksSent).toBe(762);
    expect(r!.linksOpened).toBe(601);
    expect(r!.lastFrameToSend.medianSec).toBe(45);
    expect(r!.hours.length).toBe(OKTANE_RECAP.hours.length);
  });

  it("refuses an unknown version or a missing name rather than half-filling", () => {
    expect(normalizeRecap({ ...OKTANE_RECAP, version: 2 })).toBeNull();
    expect(normalizeRecap({ ...OKTANE_RECAP, eventName: "" })).toBeNull();
    expect(normalizeRecap(null)).toBeNull();
    expect(normalizeRecap("{}")).toBeNull();
  });

  it("coerces junk counts to zero and drops malformed hours", () => {
    const r = normalizeRecap({
      ...OKTANE_RECAP,
      guestsCheckedIn: "704",
      totalOpens: -3,
      hours: [{ startsAt: "2026-09-22T13:00:00-07:00", sent: 2, opened: 2 }, { sent: 1 }, null],
    });
    expect(r!.guestsCheckedIn).toBe(0);
    expect(r!.totalOpens).toBe(0);
    expect(r!.hours).toHaveLength(1);
  });

  it("sorts hours ascending whatever order SPS sent them in", () => {
    const r = normalizeRecap({
      ...OKTANE_RECAP,
      hours: [...OKTANE_RECAP.hours].reverse(),
    });
    expect(r!.hours[0].startsAt).toBe(OKTANE_RECAP.hours[0].startsAt);
  });
});

describe("recapPassesFloor", () => {
  it("passes Oktane and refuses a small office day", () => {
    const r = normalizeRecap(OKTANE_RECAP)!;
    expect(recapPassesFloor(r)).toBe(true);
    expect(recapPassesFloor({ ...r, guestsCheckedIn: 12 })).toBe(false);
    expect(recapPassesFloor({ ...r, linksSent: 19 })).toBe(false);
    expect(recapPassesFloor(null)).toBe(false);
  });
});

describe("derived numbers", () => {
  it("open rate is a whole percent of links sent", () => {
    expect(recapOpenRate(normalizeRecap(OKTANE_RECAP)!)).toBe(79);
    expect(recapOpenRate({ ...normalizeRecap(OKTANE_RECAP)!, linksSent: 0 })).toBeNull();
  });

  it("formats seconds the way a client reads them", () => {
    expect(formatSeconds(45)).toBe("45 sec");
    expect(formatSeconds(89)).toBe("89 sec");
    expect(formatSeconds(181)).toBe("3 min");
    expect(formatSeconds(150)).toBe("2.5 min");
    expect(formatSeconds(900)).toBe("15 min");
    expect(formatSeconds(null)).toBeNull();
  });

  it("groups hours into the local shooting days", () => {
    const days = recapDays(normalizeRecap(OKTANE_RECAP)!);
    // Five calendar days with a send: three shooting days and two re-sends
    // after the event. The chart narrows to the capture window; this does not.
    expect(days.map((d) => d.date)).toEqual(["2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-28"]);
    expect(days[2].hours.reduce((n, h) => n + h.sent, 0)).toBe(204);
  });
});
