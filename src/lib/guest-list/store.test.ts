import { describe, it, expect } from "vitest";
import { readGuestList } from "./store";

const meta = (key: string) => ({ guestList: { key, tokenHash: "h", filename: "g.xlsx", uploadedAt: "", source: "manual-upload", sizeBytes: 1 } });

describe("readGuestList — key pinned to the event's own folder", () => {
  it("returns a guest list stored in this event's attachments", () => {
    expect(readGuestList(meta("events/e1/attachments/guest-list.xlsx"), "e1")?.key).toBe("events/e1/attachments/guest-list.xlsx");
  });

  it("ignores a key copied from another event (the old duplicate path)", () => {
    expect(readGuestList(meta("events/e0/attachments/guest-list.xlsx"), "e1")).toBeNull();
  });

  it("ignores a key outside attachments, and a missing event id", () => {
    expect(readGuestList(meta("events/e1/originals/x.jpg"), "e1")).toBeNull();
    expect(readGuestList(meta("events/e1/attachments/guest-list.xlsx"), "")).toBeNull();
  });
});
