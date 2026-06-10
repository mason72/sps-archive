import { describe, expect, it } from "vitest";
import { AUTO_FOCAL_MIN_QUALITY, computeAutoFocal, type FaceBox } from "./focal";

function face(overrides: Partial<FaceBox> = {}): FaceBox {
  // A confident half-body portrait face: centered, ~3% of frame.
  return {
    bbox_x: 0.4,
    bbox_y: 0.2,
    bbox_w: 0.2,
    bbox_h: 0.15,
    quality: 0.6,
    ...overrides,
  };
}

describe("computeAutoFocal", () => {
  it("places the focal at eye level of a single confident face", () => {
    const focal = computeAutoFocal([face()]);
    // x = (0.4 + 0.2/2) * 100 = 50; y = (0.2 + 0.15*0.35) * 100 = 25.25 → 25.3
    expect(focal).toEqual({ x: 50, y: 25.3 });
  });

  it("returns null when no faces are detected", () => {
    expect(computeAutoFocal([])).toBeNull();
  });

  it("returns null when no face clears the quality bar", () => {
    expect(
      computeAutoFocal([face({ quality: AUTO_FOCAL_MIN_QUALITY - 0.01 })])
    ).toBeNull();
  });

  it("returns null for two confident faces (couples/groups need a human)", () => {
    expect(
      computeAutoFocal([face(), face({ bbox_x: 0.7, quality: 0.5 })])
    ).toBeNull();
  });

  it("ignores bystander faces below the bar when one clear subject exists", () => {
    const focal = computeAutoFocal([
      face(),
      face({ bbox_x: 0.05, bbox_w: 0.04, bbox_h: 0.03, quality: 0.1 }),
    ]);
    expect(focal).toEqual({ x: 50, y: 25.3 });
  });

  it("clamps and rounds to one decimal", () => {
    const focal = computeAutoFocal([
      face({ bbox_x: 0.91, bbox_w: 0.2, bbox_y: 0.97, bbox_h: 0.12 }),
    ]);
    expect(focal).toEqual({ x: 100, y: 100 });
  });
});
