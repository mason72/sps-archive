import { describe, it, expect } from "vitest";
import {
  eventLabelKeys,
  EVENT_LABEL_MIN_COUNT,
  EVENT_LABEL_MIN_SHARE,
} from "./event-labels";

const rows = (eventId: string, key: string, n: number) =>
  Array.from({ length: n }, () => ({ eventId, key }));

describe("eventLabelKeys", () => {
  it("names the label of a booth export — every file parses to the job", () => {
    // Core SJC, 2026-09-02: 287 of 287 → "Google Booth".
    const labels = eventLabelKeys(rows("sjc", "googlebooth", 287), new Map([["sjc", 287]]));
    expect(labels.get("sjc")).toEqual(new Set(["googlebooth"]));
  });

  it("leaves a real sitting alone — tens of frames, never a hundred", () => {
    // "Nachi", 48 of 48: the largest single-person sitting in the archive.
    const labels = eventLabelKeys(rows("n", "nachi", 48), new Map([["n", 48]]));
    expect(labels.size).toBe(0);
  });

  it("judges share against the WHOLE event, unnamed frames included", () => {
    // 120 labelled + 200 camera-named: 37% — not dominant.
    const labels = eventLabelKeys(rows("e", "acme", 120), new Map([["e", 320]]));
    expect(labels.size).toBe(0);
    // Same 120 in a 200-photo event: 60% — the label.
    expect(eventLabelKeys(rows("e", "acme", 120), new Map([["e", 200]])).get("e")).toEqual(
      new Set(["acme"])
    );
  });

  it("is per event: a name can label one event and be a person in another", () => {
    const labels = eventLabelKeys(
      [...rows("school", "grace", 150), ...rows("headshots", "grace", 12)],
      new Map([
        ["school", 160],
        ["headshots", 40],
      ])
    );
    expect(labels.get("school")).toEqual(new Set(["grace"]));
    expect(labels.has("headshots")).toBe(false);
  });

  it("keeps a heavily photographed guest at a big event", () => {
    // Steven Hughes: 184 frames of DAIS 26's 9,092 — a person, 2% of the day.
    const labels = eventLabelKeys(rows("dais", "stevenhughes", 184), new Map([["dais", 9092]]));
    expect(labels.size).toBe(0);
  });

  it("sits exactly on its documented thresholds", () => {
    const at = eventLabelKeys(
      rows("e", "x", EVENT_LABEL_MIN_COUNT),
      new Map([["e", EVENT_LABEL_MIN_COUNT / EVENT_LABEL_MIN_SHARE]])
    );
    expect(at.get("e")).toEqual(new Set(["x"]));
    const under = eventLabelKeys(
      rows("e", "x", EVENT_LABEL_MIN_COUNT - 1),
      new Map([["e", EVENT_LABEL_MIN_COUNT - 1]])
    );
    expect(under.size).toBe(0);
  });
});
