import { describe, expect, it } from "vitest";
import { clientSettingsForCreate, mergeClientSettings } from "./settings-guard";
import { isWorkGalleryEvent } from "@/lib/site/jobs";
import { readRecapSettings } from "@/lib/recap/payload";

describe("settings guard", () => {
  it("a client cannot turn its event into the Work or Website gallery", () => {
    const merged = mergeClientSettings({ cover: { type: "image" } }, { work: true, website: true, sharing: { a: 1 } });
    expect(merged).toEqual({ cover: { type: "image" }, sharing: { a: 1 } });
  });

  it("a client cannot clear the flags on the real galleries either", () => {
    const merged = mergeClientSettings({ work: true, cover: {} }, { work: false, cover: { type: "mosaic" } });
    expect(merged).toEqual({ work: true, cover: { type: "mosaic" } });
  });

  it("drops server-owned keys on create and tolerates junk", () => {
    expect(clientSettingsForCreate({ website: true, sharing: {} })).toEqual({ sharing: {} });
    expect(clientSettingsForCreate(null)).toBeUndefined();
    expect(clientSettingsForCreate(["work"])).toBeUndefined();
  });
});

describe("Work gallery identity", () => {
  it("is the slug, never the settings flag", () => {
    expect(isWorkGalleryEvent({ slug: "tdp-work" })).toBe(true);
    expect(isWorkGalleryEvent({ slug: "tdp-work-mf3k2" })).toBe(false);
    expect(isWorkGalleryEvent({ slug: "x", settings: { work: true } } as { slug: string })).toBe(false);
    expect(isWorkGalleryEvent(null)).toBe(false);
  });
});

describe("recap logo key", () => {
  const own = "recap/ev-1/client-logo-1.png";
  it("honors a key in this event's folder", () => {
    expect(readRecapSettings({ recap: { clientLogoKey: own } }, "ev-1").clientLogoKey).toBe(own);
  });
  it("refuses another event's key, a traversal, and a bare prefix", () => {
    for (const key of ["recap/ev-2/client-logo-1.png", "recap/ev-1/../ev-2/x.png", "recap/x.png"]) {
      expect(readRecapSettings({ recap: { clientLogoKey: key } }, "ev-1").clientLogoKey).toBeUndefined();
    }
  });
});
