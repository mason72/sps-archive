import { describe, it, expect } from "vitest";
import { isValidScene, deriveServiceFromScene, SITE_SCENES } from "./scenes";

describe("isValidScene", () => {
  it("accepts known flat and namespaced scene keys", () => {
    expect(isValidScene("hero")).toBe(true);
    expect(isValidScene("featured-work")).toBe(true);
    expect(isValidScene("service/headshot-booth")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isValidScene("nope")).toBe(false);
    expect(isValidScene("service/unknown")).toBe(false);
    expect(isValidScene("")).toBe(false);
  });
});

describe("deriveServiceFromScene", () => {
  it("extracts the service for service/* scenes", () => {
    expect(deriveServiceFromScene("service/photo-booth")).toBe("photo-booth");
    expect(deriveServiceFromScene("service/environmental-portraits")).toBe(
      "environmental-portraits"
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
});
