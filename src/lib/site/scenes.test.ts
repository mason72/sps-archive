import { describe, it, expect } from "vitest";
import {
  isValidScene,
  isSlotScene,
  sceneForKey,
  deriveServiceFromScene,
  SITE_SCENES,
} from "./scenes";

describe("isValidScene", () => {
  it("accepts known flat and namespaced scene keys", () => {
    expect(isValidScene("hero")).toBe(true);
    expect(isValidScene("featured-work")).toBe(true);
    expect(isValidScene("service/photo-booth")).toBe(true);
    expect(isValidScene("photo-booth/overhead")).toBe(true);
    expect(isValidScene("slot/slice-1")).toBe(true);
    expect(isValidScene("slot/hero/photo-booth")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isValidScene("nope")).toBe(false);
    expect(isValidScene("service/unknown")).toBe(false);
    expect(isValidScene("slot/slice-7")).toBe(false);
    expect(isValidScene("")).toBe(false);
  });
});

describe("isSlotScene", () => {
  it("is true exactly for slot/* scenes", () => {
    expect(isSlotScene("slot/slice-3")).toBe(true);
    expect(isSlotScene("slot/hero/video")).toBe(true);
    expect(isSlotScene("hero")).toBe(false);
    expect(isSlotScene("featured-work")).toBe(false);
    expect(isSlotScene("unknown")).toBe(false);
  });

  it("matches the registry's kind field", () => {
    for (const s of SITE_SCENES) {
      expect(isSlotScene(s.key)).toBe(s.kind === "slot");
      // Naming convention and kind must agree — the API relies on kind only,
      // but humans read the key.
      expect(s.key.startsWith("slot/")).toBe(s.kind === "slot");
    }
  });
});

describe("deriveServiceFromScene", () => {
  it("extracts the service for service-implying scenes", () => {
    expect(deriveServiceFromScene("service/photo-booth")).toBe("photo-booth");
    expect(deriveServiceFromScene("photo-booth/bw-glam")).toBe("photo-booth");
    expect(deriveServiceFromScene("slot/hero/office-headshots")).toBe(
      "office-headshots"
    );
  });

  it("returns null for non-service scenes", () => {
    expect(deriveServiceFromScene("hero")).toBeNull();
    expect(deriveServiceFromScene("featured-work")).toBeNull();
    expect(deriveServiceFromScene("backgrounds")).toBeNull();
  });

  it("returns null for unknown scenes", () => {
    expect(deriveServiceFromScene("whatever")).toBeNull();
  });
});

describe("SITE_SCENES registry", () => {
  it("has unique keys", () => {
    const keys = SITE_SCENES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every service/* scene declares a matching service", () => {
    for (const s of SITE_SCENES) {
      if (s.key.startsWith("service/")) {
        expect(s.service).toBe(s.key.slice("service/".length));
      }
    }
  });

  it("covers every scene key the website expects", () => {
    // The contract list from the v2 spec — a missing key here means a website
    // page silently renders empty.
    const required = [
      "hero",
      "featured-work",
      "backgrounds",
      "service/photo-booth",
      "service/anti-booth",
      "service/video",
      "service/environmental-portraits",
      "photo-booth/overhead",
      "photo-booth/bw-glam",
      "photo-booth/custom-sets",
      "bts/headshot-booth",
      "bts/photo-booth",
      "bts/anti-booth",
      "drop-in/actors",
      ...[1, 2, 3, 4, 5, 6].map((n) => `slot/slice-${n}`),
      ...[
        "headshot-booth",
        "photo-booth",
        "anti-booth",
        "event-photography",
        "video",
        "environmental-portraits",
        "office-headshots",
        "drop-in-sessions",
      ].map((slug) => `slot/hero/${slug}`),
      "slot/og",
      ...[
        "headshot-booth",
        "photo-booth",
        "anti-booth",
        "event-photography",
        "video",
        "office-headshots",
        "drop-in-sessions",
      ].map((slug) => `benefits/${slug}`),
      "story",
      "about-values",
      "quote",
    ];
    for (const key of required) {
      expect(isValidScene(key), `missing scene: ${key}`).toBe(true);
    }
  });

  it("ordered scenes declare their position count", () => {
    const ordered = SITE_SCENES.filter((s) => s.kind === "ordered");
    expect(ordered.length).toBeGreaterThanOrEqual(10);
    for (const s of ordered) {
      expect(s.positions, `${s.key} needs positions`).toBeGreaterThan(0);
    }
    // The page layouts these map to:
    expect(sceneForKey("benefits/video")?.positions).toBe(6);
    expect(sceneForKey("story")?.positions).toBe(3);
    expect(sceneForKey("about-values")?.positions).toBe(4);
    expect(sceneForKey("quote")?.positions).toBe(2);
  });

  it("rotating slots are exactly the hero carousels + homepage slices", () => {
    for (const s of SITE_SCENES) {
      // rotates is a slot refinement — meaningless on pools/ordered. The
      // service-page heroes carousel and the homepage "What we do" slices
      // breathe; slot/og stays single-image (link previews want one photo).
      expect(!!s.rotates, `${s.key} rotates`).toBe(
        s.kind === "slot" &&
          (s.key.startsWith("slot/hero/") || s.key.startsWith("slot/slice-"))
      );
    }
  });

  it("exposes registry entries via sceneForKey", () => {
    expect(sceneForKey("hero")?.label).toBe("Hero Pool");
    expect(sceneForKey("nope")).toBeUndefined();
  });
});
