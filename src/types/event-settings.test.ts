import { describe, it, expect } from "vitest";
import {
  normalizeCoverSettings,
  pinnedCoverLogoKey,
  sanitizeCoverForEvent,
  coverShowsTitle,
  coverNeedsRaster,
  normalizeDownloadPins,
} from "./event-settings";

const EVENT = "11111111-2222-3333-4444-555555555555";

describe("pinnedCoverLogoKey", () => {
  it("accepts only this event's branding cover-logo keys", () => {
    expect(
      pinnedCoverLogoKey(EVENT, `events/${EVENT}/branding/cover-logo.png`)
    ).toBe(`events/${EVENT}/branding/cover-logo.png`);
  });

  it("rejects arbitrary bucket keys (the JSONB IDOR class)", () => {
    for (const key of [
      "events/other-event/branding/cover-logo.png",
      `events/${EVENT}/covers/cover-raster.jpg`,
      `events/${EVENT}/originals/photo.jpg`,
      "branding/cover-logo.png",
      "",
    ]) {
      expect(pinnedCoverLogoKey(EVENT, key)).toBeUndefined();
    }
    expect(pinnedCoverLogoKey(EVENT, undefined)).toBeUndefined();
  });
});

describe("sanitizeCoverForEvent", () => {
  it("strips foreign logo keys from mosaic and solid", () => {
    const cover = normalizeCoverSettings({
      enabled: true,
      type: "mosaic",
      mosaic: { logoMode: "overlay", logoKey: "events/victim/originals/x.jpg" },
      solid: { logoKey: "some/other/key.png" },
    });
    const safe = sanitizeCoverForEvent(EVENT, cover);
    expect(safe.mosaic?.logoKey).toBeUndefined();
    expect(safe.solid?.logoKey).toBeUndefined();
  });

  it("keeps this event's own logo key", () => {
    const own = `events/${EVENT}/branding/cover-logo.webp`;
    const cover = normalizeCoverSettings({
      enabled: true,
      type: "solid",
      solid: { logoKey: own, colors: ["#112233"] },
    });
    expect(sanitizeCoverForEvent(EVENT, cover).solid?.logoKey).toBe(own);
  });
});

describe("normalizeCoverSettings", () => {
  it("types legacy rows as image and keeps their fields", () => {
    const c = normalizeCoverSettings({
      enabled: true,
      imageId: "abc",
      titlePosition: "below",
      titleAlignment: "left",
    });
    expect(c.type).toBe("image");
    expect(c.imageId).toBe("abc");
    expect(c.titlePosition).toBe("below");
  });

  it("rejects malformed colors everywhere (CSS + rgba + SVG sinks)", () => {
    const c = normalizeCoverSettings({
      type: "mosaic",
      mosaic: {
        overlay: { color: "url(javascript:x)\"/><script>", opacity: 0.5 },
        insert: { fill: "red; }" },
      },
      solid: { colors: ["#GGGGGG", "not-a-color", "#AABBCC "] },
    });
    expect(c.mosaic?.overlay.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(c.mosaic?.insert.fill).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(c.solid?.colors).toEqual(["#AABBCC"]);
  });

  it("clamps focal point into 0..1", () => {
    const c = normalizeCoverSettings({ focalPoint: { x: 4, y: -2 } });
    expect(c.focalPoint).toEqual({ x: 1, y: 0 });
  });
});

describe("coverShowsTitle / coverNeedsRaster", () => {
  it("client logo replaces the title unless overridden", () => {
    const logo = `events/${EVENT}/branding/cover-logo.png`;
    const withLogo = normalizeCoverSettings({
      enabled: true,
      type: "mosaic",
      mosaic: { logoMode: "overlay", logoKey: logo },
    });
    expect(coverShowsTitle(withLogo)).toBe(false);
    expect(coverShowsTitle({ ...withLogo, hideTitle: false })).toBe(true);
    const noLogo = normalizeCoverSettings({ enabled: true, type: "mosaic" });
    expect(coverShowsTitle(noLogo)).toBe(true);
  });

  it("only enabled mosaic/solid need a raster", () => {
    expect(
      coverNeedsRaster(normalizeCoverSettings({ enabled: true, type: "mosaic" }))
    ).toBe(true);
    expect(
      coverNeedsRaster(normalizeCoverSettings({ enabled: false, type: "mosaic" }))
    ).toBe(false);
    expect(
      coverNeedsRaster(normalizeCoverSettings({ enabled: true, type: "crossfade" }))
    ).toBe(false);
  });
});

/**
 * The per-image PIN is an escalation of the bulk PIN, never a peer. These
 * pin down the combinations the UI must never be able to produce.
 */
describe("normalizeDownloadPins", () => {
  it("keeps the common setup untouched: bulk PIN only", () => {
    expect(
      normalizeDownloadPins({
        requirePinBulk: true,
        requirePinIndividual: false,
        downloadPin: "1234",
      })
    ).toEqual({
      requirePinBulk: true,
      requirePinIndividual: false,
      downloadPin: "1234",
    });
  });

  it("keeps both on when both are asked for", () => {
    const r = normalizeDownloadPins({
      requirePinBulk: true,
      requirePinIndividual: true,
      downloadPin: "1234",
    });
    expect(r.requirePinBulk).toBe(true);
    expect(r.requirePinIndividual).toBe(true);
  });

  it("drops individual when bulk is off — the combination that gated nothing", () => {
    const r = normalizeDownloadPins({
      requirePinBulk: false,
      requirePinIndividual: true,
      downloadPin: "1234",
    });
    expect(r.requirePinIndividual).toBe(false);
    expect(r.requirePinBulk).toBe(false);
  });

  it("never escalates: individual must not switch bulk ON", () => {
    const r = normalizeDownloadPins({
      requirePinBulk: false,
      requirePinIndividual: true,
      downloadPin: "1234",
    });
    expect(r.requirePinBulk).toBe(false);
  });

  it("drops both flags when no PIN is set — a gate with no secret refuses everyone", () => {
    const r = normalizeDownloadPins({
      requirePinBulk: true,
      requirePinIndividual: true,
      downloadPin: "",
    });
    expect(r.requirePinBulk).toBe(false);
    expect(r.requirePinIndividual).toBe(false);
  });

  it("treats missing flags as off", () => {
    const r = normalizeDownloadPins({ downloadPin: "1234" });
    expect(r.requirePinBulk).toBe(false);
    expect(r.requirePinIndividual).toBe(false);
  });

  it("leaves unrelated fields alone", () => {
    const r = normalizeDownloadPins({
      requirePinBulk: true,
      requirePinIndividual: false,
      downloadPin: "1234",
      password: "hunter2",
      allowDownload: true,
    } as Record<string, unknown> & { requirePinBulk: boolean });
    expect(r.password).toBe("hunter2");
    expect(r.allowDownload).toBe(true);
  });
});

describe("photo cover fit (scale-to-fit for logos)", () => {
  it("defaults to cover with 10% padding", () => {
    const c = normalizeCoverSettings({});
    expect(c.image).toEqual({ fit: "cover", padding: 10 });
  });

  it("parses contain and clamps padding to 0-40", () => {
    expect(
      normalizeCoverSettings({ image: { fit: "contain", padding: 22 } }).image
    ).toEqual({ fit: "contain", padding: 22 });
    expect(
      normalizeCoverSettings({ image: { fit: "contain", padding: 99 } }).image
        ?.padding
    ).toBe(40);
    expect(
      normalizeCoverSettings({ image: { fit: "contain", padding: -5 } }).image
        ?.padding
    ).toBe(0);
  });

  it("rejects junk fit values back to cover", () => {
    expect(
      normalizeCoverSettings({ image: { fit: "stretch", padding: 10 } }).image
        ?.fit
    ).toBe("cover");
  });

  it("survives sanitizeCoverForEvent", () => {
    const c = normalizeCoverSettings({ image: { fit: "contain", padding: 18 } });
    expect(sanitizeCoverForEvent("evt-1", c).image).toEqual({
      fit: "contain",
      padding: 18,
    });
  });
});
