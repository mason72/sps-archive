import { describe, it, expect } from "vitest";
import { liveVerdict } from "./live-activity";

const quiet = { uploads: [], dated: [], pullsInFlight: [] };

/**
 * This verdict gates pushes to production. It was changed on 2026-10-04 to
 * stop counting rows a finished SPS pull landed, which makes it MORE willing
 * to say quiet, so every case below is about not saying quiet wrongly.
 */
describe("liveVerdict", () => {
  it("is quiet when nothing is happening", () => {
    expect(liveVerdict(quiet)).toEqual({ live: false, reasons: [] });
  });

  it("is LIVE on a person's upload, and names the event", () => {
    const v = liveVerdict({ ...quiet, uploads: [{ name: "Gala 2026", count: 12 }] });
    expect(v.live).toBe(true);
    expect(v.reasons).toEqual(["uploads to Gala 2026 (12)"]);
  });

  it("marks counts as floors when the read was capped", () => {
    const v = liveVerdict({ ...quiet, uploads: [{ name: "Gala 2026", count: 80 }], uploadsCapped: true });
    expect(v.reasons).toEqual(["uploads to Gala 2026 (80+)"]);
  });

  it("is LIVE on a single upload", () => {
    expect(liveVerdict({ ...quiet, uploads: [{ name: "Gala 2026", count: 1 }] }).live).toBe(true);
  });

  it("is LIVE for an event dated now, with no upload yet", () => {
    const v = liveVerdict({ ...quiet, dated: [{ name: "Summit", date: "2026-10-04" }] });
    expect(v.live).toBe(true);
    expect(v.reasons[0]).toContain("Summit");
  });

  it("is LIVE while an SPS pull is running or queued", () => {
    // A deploy kills the step in flight. This is the half of "pull activity"
    // that still gates.
    for (const status of ["running", "queued"]) {
      const v = liveVerdict({ ...quiet, pullsInFlight: [{ name: "AAOMS 2026", status }] });
      expect(v.live).toBe(true);
      expect(v.reasons[0]).toBe(`SPS pull in flight: AAOMS 2026 (${status})`);
    }
  });

  it("names every reason, not just the first", () => {
    const v = liveVerdict({
      uploads: [{ name: "Gala 2026", count: 3 }],
      dated: [{ name: "Summit", date: "2026-10-04" }],
      pullsInFlight: [{ name: "AAOMS 2026", status: "running" }],
    });
    expect(v.reasons).toHaveLength(3);
  });
});
