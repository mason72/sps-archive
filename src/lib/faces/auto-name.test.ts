import { describe, expect, it } from "vitest";

import { eventLabelKeys } from "@/lib/people/event-labels";
import { personKeyForImage } from "@/lib/people/index-people";

import { autoNameFor, frameName } from "./cluster-event";

describe("autoNameFor", () => {
  it("uses a consensus name nobody has blocked", () => {
    expect(autoNameFor("Jenna Loeser", [], new Set())).toBe("Jenna Loeser");
  });

  it("passes a missing consensus through", () => {
    expect(autoNameFor(null, [], new Set(["jennaloeser"]))).toBeNull();
  });

  it("never re-applies a name a human rejected for this cluster", () => {
    expect(autoNameFor("Jenna Loeser", ["jenna loeser"], new Set())).toBeNull();
  });

  it("never uses a blocked name, in any spelling", () => {
    const blocked = new Set(["wekasko"]);
    expect(autoNameFor("Weka SKO27", [], blocked)).toBeNull();
    expect(autoNameFor("WEKA sko-27", [], blocked)).toBeNull();
  });
});

describe("the WEKA gallery, by the wall's label rule", () => {
  // Real filename from WEKA SKO27 // Event Photos (200 photos, every one
  // carrying the gallery name) — the namer read it as a person and named all
  // 57 face clusters with it.
  const wekaKey = personKeyForImage("WekaSKO27 EventPhotos", "WekaSKO27_EventPhotos-03055.jpg");

  it("reads the filename as the wall's key, which the exclusion and the label rule use", () => {
    expect(wekaKey).toBe("wekaskoeventphotos");
  });

  it("casts no namer vote at all since the agreement rule (lesson 148)", () => {
    expect(frameName("WekaSKO27 EventPhotos", "WekaSKO27_EventPhotos-03055.jpg")).toBeNull();
  });

  it("is a label: ≥100 frames and ≥10% of its event", () => {
    const rows = Array.from({ length: 190 }, () => ({ eventId: "weka", key: wekaKey }));
    expect(eventLabelKeys(rows, new Map([["weka", 200]])).get("weka")?.has(wekaKey)).toBe(true);
  });

  it("leaves a real sitting alone — tens of frames, never 100", () => {
    const rows = Array.from({ length: 48 }, () => ({ eventId: "day", key: "nachi" }));
    expect(eventLabelKeys(rows, new Map([["day", 60]])).get("day")).toBeUndefined();
  });
});
