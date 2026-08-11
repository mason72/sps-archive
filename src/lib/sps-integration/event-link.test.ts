import { describe, it, expect } from "vitest";
import {
  readSpsEventId,
  readSpsEventLink,
  spsEventLinkPatch,
} from "./event-link";

describe("readSpsEventLink", () => {
  it("reads the flat key the importer has always written", () => {
    expect(readSpsEventId({ spsEventId: "sps-123", source: "sps-import" })).toBe(
      "sps-123"
    );
  });

  it("still reads the nested shape the old design note specified", () => {
    // The whole point of this file: a row written against the doc instead of
    // against import.ts must not read as unlinked.
    expect(readSpsEventId({ sps: { eventId: "sps-456" } })).toBe("sps-456");
  });

  it("prefers the flat key when a row somehow carries both", () => {
    expect(
      readSpsEventId({ spsEventId: "flat", sps: { eventId: "nested" } })
    ).toBe("flat");
  });

  it("returns null for an unlinked event, and never throws on junk", () => {
    for (const s of [null, undefined, {}, { sps: {} }, { spsEventId: "" }, { spsEventId: "   " }, { sps: { eventId: 42 } }]) {
      expect(readSpsEventId(s as never)).toBeNull();
    }
  });

  it("carries the display name but never lets it stand in for an id", () => {
    expect(readSpsEventLink({ spsEventName: "Hotel Data Conference" })).toBeNull();
    expect(
      readSpsEventLink({ spsEventId: "x", spsEventName: "  Hotel Data  " })
    ).toMatchObject({ eventId: "x", eventName: "Hotel Data" });
  });

  it("normalises an unrecognised source to undefined", () => {
    expect(readSpsEventLink({ spsEventId: "x", source: "whatever" })?.source).toBeUndefined();
    expect(readSpsEventLink({ spsEventId: "x", source: "sps-import" })?.source).toBe("sps-import");
  });
});

describe("spsEventLinkPatch", () => {
  it("writes the FLAT key only — the nested shape is read-only legacy", () => {
    const patch = spsEventLinkPatch({
      eventId: "sps-789",
      eventName: "What If? Summit",
      linkedAt: "2026-08-11T20:00:00.000Z",
      source: "manual-link",
    });
    expect(patch).toEqual({
      spsEventId: "sps-789",
      spsEventName: "What If? Summit",
      spsLinkedAt: "2026-08-11T20:00:00.000Z",
      source: "manual-link",
    });
    expect(patch).not.toHaveProperty("sps");
  });

  it("round-trips through the reader", () => {
    const patch = spsEventLinkPatch({
      eventId: "sps-1",
      eventName: null,
      linkedAt: "2026-08-11T20:00:00.000Z",
    });
    expect(readSpsEventLink(patch)).toMatchObject({
      eventId: "sps-1",
      eventName: null,
      source: "manual-link",
    });
  });

  it("merges into existing settings without eating its siblings", () => {
    const existing = { cover: { type: "mosaic" }, guestList: { key: "k" } };
    const merged = { ...existing, ...spsEventLinkPatch({ eventId: "s", linkedAt: "t" }) };
    expect(merged.cover).toEqual({ type: "mosaic" });
    expect(merged.guestList).toEqual({ key: "k" });
    expect(readSpsEventId(merged)).toBe("s");
  });
});
