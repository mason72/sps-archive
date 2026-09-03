import { describe, it, expect } from "vitest";
import {
  normalizeCoverSettings,
  pinnedCoverLogoKey,
  sanitizeCoverForEvent,
  coverShowsTitle,
  coverNeedsRaster,
  normalizeDownloadPins,
  resolveSharePins,
  selfieSearchEnabled,
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
        overlay: {
          // Legacy single-colour field, and the array that replaced it. BOTH
          // end up inside an SVG string in raster.ts, so every entry has to
          // come back a safe hex — the gradient widened this from one
          // interpolation to five.
          color: "url(javascript:x)\"/><script>",
          colors: ["#AABBCC ", "</style><script>alert(1)</script>", "#GG0000"],
          opacity: 0.5,
          blurAmount: 9999,
        },
        insert: { fill: "red; }" },
      },
      solid: { colors: ["#GGGGGG", "not-a-color", "#AABBCC "] },
    });
    for (const c0 of c.mosaic?.overlay.colors ?? []) {
      expect(c0).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
    expect(c.mosaic?.overlay.colors).toEqual(["#AABBCC"]);
    expect(c.mosaic?.overlay.blurAmount).toBeLessThanOrEqual(40);
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

describe("selfieSearchEnabled", () => {
  it("is ON when the key was never written", () => {
    // The state of all 14 events that existed when the default flipped
    // (2026-08-10) — a `=== true` read would have left every one of them dark.
    expect(selfieSearchEnabled({})).toBe(true);
    expect(selfieSearchEnabled(undefined)).toBe(true);
    expect(selfieSearchEnabled(null)).toBe(true);
  });

  it("respects an explicit opt-out and only an explicit opt-out", () => {
    expect(selfieSearchEnabled({ selfieSearch: false })).toBe(false);
    expect(selfieSearchEnabled({ selfieSearch: true })).toBe(true);
  });
});

describe("resolveSharePins", () => {
  const gatedEvent = {
    downloadPin: "1234",
    requirePinBulk: true,
    requirePinIndividual: false,
  };

  it("inherits the event's PIN when the caller asks for event defaults", () => {
    const r = resolveSharePins({ useEventDefaults: true, event: gatedEvent });
    expect(r).toEqual({ downloadPin: "1234", requirePinBulk: true, requirePinIndividual: false });
  });

  it("inherits the event's PIN even WITHOUT useEventDefaults", () => {
    // The regression that shipped: the email composer creates a share without
    // that flag, so the gallery went out ungated in the email announcing it.
    const r = resolveSharePins({ event: gatedEvent });
    expect(r.downloadPin).toBe("1234");
    expect(r.requirePinBulk).toBe(true);
  });

  it("reproduces the live share that was minted with a null PIN", () => {
    // A share created while the event already had requirePinBulk on, by a
    // caller that passed no PIN fields at all, must now come out gated.
    const r = resolveSharePins({ event: gatedEvent, body: {} });
    expect(r.requirePinBulk).toBe(true);
    expect(r.downloadPin).toBe("1234");
  });

  it("lets an explicit PIN in the body override the event's", () => {
    const r = resolveSharePins({
      event: gatedEvent,
      body: { downloadPin: "9876", requirePinBulk: true },
    });
    expect(r.downloadPin).toBe("9876");
  });

  it("lets the body explicitly decline the bulk gate", () => {
    const r = resolveSharePins({ event: gatedEvent, body: { requirePinBulk: false } });
    expect(r.requirePinBulk).toBe(false);
    expect(r.requirePinIndividual).toBe(false);
  });

  it("an ungated event produces an ungated share", () => {
    const r = resolveSharePins({ event: {} });
    expect(r).toEqual({ downloadPin: "", requirePinBulk: false, requirePinIndividual: false });
  });

  it("never returns a gate with no secret behind it", () => {
    // authorizeShareDownload fails closed, so this would lock out everyone
    // including the owner.
    const r = resolveSharePins({ event: { requirePinBulk: true, downloadPin: "" } });
    expect(r.requirePinBulk).toBe(false);
    expect(r.requirePinIndividual).toBe(false);
  });

  it("keeps individual as an escalation of bulk, never a peer", () => {
    const r = resolveSharePins({
      event: { downloadPin: "1234", requirePinBulk: false, requirePinIndividual: true },
    });
    expect(r.requirePinBulk).toBe(false);
    expect(r.requirePinIndividual).toBe(false);
  });

  it("carries the individual escalation through inheritance", () => {
    const r = resolveSharePins({
      event: { downloadPin: "1234", requirePinBulk: true, requirePinIndividual: true },
    });
    expect(r.requirePinIndividual).toBe(true);
  });
});

describe("normalizeCoverSettings — defaults chosen 2026-09-02", () => {
  it("defaults a typeless cover with no photo to mosaic", () => {
    // Mason: "can we make Mosaic the default cover style?" A legacy row that
    // picked a photo before `type` existed is the one exception (tested above).
    expect(normalizeCoverSettings({}).type).toBe("mosaic");
    expect(normalizeCoverSettings({ enabled: true }).type).toBe("mosaic");
    expect(normalizeCoverSettings({ imageId: "abc" }).type).toBe("image");
  });

  it("clamps the logo size into 0.25–1 and defaults it to full size", () => {
    expect(normalizeCoverSettings({}).mosaic!.logoScale).toBe(1);
    expect(normalizeCoverSettings({ mosaic: { logoScale: 0.5 } }).mosaic!.logoScale).toBe(0.5);
    expect(normalizeCoverSettings({ mosaic: { logoScale: 0 } }).mosaic!.logoScale).toBe(0.25);
    expect(normalizeCoverSettings({ mosaic: { logoScale: 7 } }).mosaic!.logoScale).toBe(1);
    expect(normalizeCoverSettings({ mosaic: { logoScale: "big" } }).mosaic!.logoScale).toBe(1);
  });
});
