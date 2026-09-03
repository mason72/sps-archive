import { describe, it, expect } from "vitest";
import { applyPreviewSettings, coverGalleryFieldsSync, previewNeedsReload } from "./gallery-fields";
import { DEFAULT_EVENT_SETTINGS, normalizeCoverSettings, type EventSettings } from "@/types/event-settings";

const settings = (cover: Record<string, unknown>): EventSettings => ({
  ...DEFAULT_EVENT_SETTINGS,
  cover: normalizeCoverSettings(cover),
});

describe("applyPreviewSettings", () => {
  it("re-maps the cover from new settings while keeping the signed logo URL", () => {
    const prev = coverGalleryFieldsSync(
      normalizeCoverSettings({ enabled: true, type: "mosaic", mosaic: { logoMode: "insert", insert: { padding: 15 } } }),
      "https://signed/logo"
    );
    const next = settings({ enabled: true, type: "mosaic", mosaic: { logoMode: "insert", insert: { padding: 40 }, logoScale: 0.5 } });
    const out = applyPreviewSettings(prev, next);
    expect(out.coverMosaic?.insert.padding).toBe(40);
    expect(out.coverMosaic?.logoScale).toBe(0.5);
    expect(out.coverMosaic?.logoUrl).toBe("https://signed/logo");
  });

  it("drops a photo cover URL when the photo cover is switched off", () => {
    const prev = { coverImageUrl: "https://signed/photo", coverType: "image" as const };
    const out = applyPreviewSettings(prev, settings({ enabled: true, type: "mosaic" }));
    expect(out.coverImageUrl).toBeUndefined();
    expect(out.coverType).toBe("mosaic");
  });
});

describe("previewNeedsReload", () => {
  it("is false for layout tweaks and true only for a new photo or logo file", () => {
    const base = settings({ enabled: true, type: "mosaic", mosaic: { logoKey: "events/e/branding/a.png", insert: { padding: 15 } } });
    expect(previewNeedsReload(base, settings({ enabled: true, type: "mosaic", mosaic: { logoKey: "events/e/branding/a.png", insert: { padding: 30 }, rows: 4 } }))).toBe(false);
    expect(previewNeedsReload(base, settings({ enabled: true, type: "mosaic", mosaic: { logoKey: "events/e/branding/b.png" } }))).toBe(true);
    expect(previewNeedsReload(base, settings({ enabled: true, type: "image", imageId: "img-1" }))).toBe(true);
  });
});
