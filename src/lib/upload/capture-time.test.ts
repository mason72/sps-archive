import { describe, expect, it } from "vitest";
import {
  captureInstant,
  legacyCaptureInstants,
  parseOffsetMinutes,
} from "./capture-time";
import { frameKeys } from "../../../scripts/pixieset/twin-skip";

describe("captureInstant", () => {
  it("honours OffsetTimeOriginal (the AU2026 frame, Canon R3)", () => {
    // Measured 2026-09-24: SPS pull stored 01:27:35Z, upload stored 08:27:35Z.
    // Both paths now agree. (That body's clock was ~11h fast, so agreeing is
    // all a zone rule can do for it.)
    expect(captureInstant("2026:09:17 01:27:35", "-08:00")).toBe("2026-09-17T09:27:35.000Z");
  });

  it("honours east- and west-of-UTC offsets", () => {
    expect(captureInstant("2026:03:17 11:03:40", "-04:00")).toBe("2026-03-17T15:03:40.000Z");
    expect(captureInstant("2026:06:01 12:00:00", "+05:30")).toBe("2026-06-01T06:30:00.000Z");
  });

  it("reads an untagged clock as Pacific, DST-aware", () => {
    expect(captureInstant("2026:09:17 01:27:35", null)).toBe("2026-09-17T08:27:35.000Z"); // PDT
    expect(captureInstant("2026:01:15 18:00:00", undefined)).toBe("2026-01-16T02:00:00.000Z"); // PST
  });

  it("settles the DST transition days", () => {
    // 2026-03-08 02:00 PST → 03:00 PDT. 01:30 is still PST, 03:30 is PDT.
    expect(captureInstant("2026:03:08 01:30:00", null)).toBe("2026-03-08T09:30:00.000Z");
    expect(captureInstant("2026:03:08 03:30:00", null)).toBe("2026-03-08T10:30:00.000Z");
    // The hour that never happens moves forward, as the old reader did: 02:30 → 03:30 PDT.
    expect(captureInstant("2026:03:08 02:30:00", null)).toBe("2026-03-08T10:30:00.000Z");
    // 2026-11-01 02:00 PDT → 01:00 PST. 00:30 PDT, 03:00 PST.
    // 01:30 happens twice; take the first (PDT), as the old reader did.
    expect(captureInstant("2026:11:01 01:30:00", null)).toBe("2026-11-01T08:30:00.000Z");
    expect(captureInstant("2026:11:01 00:30:00", null)).toBe("2026-11-01T07:30:00.000Z");
    expect(captureInstant("2026:11:01 03:00:00", null)).toBe("2026-11-01T11:00:00.000Z");
  });

  it("treats +00:00 as an unset zone, not as UTC (Kinexions, Las Vegas)", () => {
    // Raw 13:19 on a Vegas booth: Pacific says 13:19 PDT, believing the tag says 06:19.
    expect(captureInstant("2026:06:03 13:19:08", "+00:00")).toBe("2026-06-03T20:19:08.000Z");
    expect(captureInstant("2026:06:03 13:19:08", "-00:00")).toBe("2026-06-03T20:19:08.000Z");
  });

  it("falls back to the zone when the offset tag is junk", () => {
    expect(captureInstant("2026:09:17 01:27:35", "   ")).toBe("2026-09-17T08:27:35.000Z");
    expect(captureInstant("2026:09:17 01:27:35", "-25:00")).toBe("2026-09-17T08:27:35.000Z");
  });

  it("returns null for blank or missing clocks rather than inventing a date", () => {
    expect(captureInstant("0000:00:00 00:00:00", "-08:00")).toBeNull();
    expect(captureInstant("    :  :     :  :  ", null)).toBeNull();
    expect(captureInstant(undefined, "-08:00")).toBeNull();
    // A revived Date is refused: it was already read in the runtime's zone.
    expect(captureInstant(new Date(), null)).toBeNull();
  });

  it("does not depend on the runtime's own zone", () => {
    // vitest runs in whatever TZ the machine has; the answer must not move.
    // The fallback path is the one that used to: pin it to a far-off zone.
    expect(captureInstant("2026:09:17 01:27:35", null, "Asia/Tokyo")).toBe("2026-09-16T16:27:35.000Z");
  });
});

describe("parseOffsetMinutes", () => {
  it("parses the EXIF shapes", () => {
    expect(parseOffsetMinutes("-08:00")).toBe(-480);
    expect(parseOffsetMinutes("+0530")).toBe(330);
    expect(parseOffsetMinutes("+14:00")).toBe(840);
    expect(parseOffsetMinutes("+14:30")).toBeNull();
    expect(parseOffsetMinutes("-07:60")).toBeNull();
    expect(parseOffsetMinutes("+00:00")).toBeNull();
    expect(parseOffsetMinutes(null)).toBeNull();
  });
});

describe("legacyCaptureInstants", () => {
  it("reproduces the old Pacific reader on every DST edge", () => {
    // The old reader was `new Date(revived)` on a Mac in Los Angeles. Pin the
    // runtime to LA and compare against V8 directly for the awkward hours.
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      for (const raw of ["2026:03:08 01:30:00", "2026:03:08 02:30:00", "2026:03:08 03:30:00",
        "2026:11:01 00:30:00", "2026:11:01 01:30:00", "2026:11:01 02:30:00", "2026:07:04 12:00:00"]) {
        const [d, t] = raw.split(" ");
        const v8 = new Date(`${d.replace(/:/g, "-")}T${t}`).toISOString();
        expect(legacyCaptureInstants(raw)[1]).toBe(v8); // [1] is the Pacific read, not the UTC one
      }
    } finally {
      process.env.TZ = prev;
    }
  });

  it("lists what the old reader stored on Vercel (UTC) and in Pacific", () => {
    expect(legacyCaptureInstants("2026:09:17 01:27:35")).toEqual([
      "2026-09-17T01:27:35.000Z",
      "2026-09-17T08:27:35.000Z",
    ]);
    expect(legacyCaptureInstants(null)).toEqual([]);
  });
});

describe("twin-skip frameKeys", () => {
  it("matches a new frame against rows stored by either old path", () => {
    const exif = {
      takenAt: captureInstant("2026:09:17 01:27:35", "-08:00"),
      legacyTakenAt: legacyCaptureInstants("2026:09:17 01:27:35"),
    };
    expect(frameKeys(exif, 1234)).toEqual([
      "2026-09-17T09:27:35.000Z|1234",
      "2026-09-17T01:27:35.000Z|1234",
      "2026-09-17T08:27:35.000Z|1234",
    ]);
  });

  it("collapses to one key when the corrected and legacy instants agree", () => {
    const exif = {
      takenAt: captureInstant("2026:09:17 01:27:35", null),
      legacyTakenAt: legacyCaptureInstants("2026:09:17 01:27:35"),
    };
    expect(frameKeys(exif, 1)).toHaveLength(2);
  });

  it("gives no keys to a frame with no capture time", () => {
    expect(frameKeys(null, 1)).toEqual([]);
    expect(frameKeys({ takenAt: null, legacyTakenAt: [] }, 1)).toEqual([]);
  });
});
