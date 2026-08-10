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

  it("anchors a group at the union-box center, mean eye level", () => {
    const focal = computeAutoFocal([
      face(), // 0.4..0.6, eye y = 0.2 + 0.0525 = 0.2525
      face({ bbox_x: 0.7, quality: 0.5 }), // 0.7..0.9, same eye level
    ]);
    // union: left 0.4, right 0.9 → x = 65; y = mean(25.25, 25.25) = 25.3
    expect(focal).toEqual({ x: 65, y: 25.3 });
  });

  it("group eye level averages faces at different heights", () => {
    const focal = computeAutoFocal([
      face({ bbox_y: 0.1 }), // eye 0.1525
      face({ bbox_x: 0.7, bbox_y: 0.5, quality: 0.5 }), // eye 0.5525
    ]);
    // y = mean(15.25, 55.25) = 35.25 → 35.3
    expect(focal?.y).toBe(35.3);
  });

  it("bystanders below the bar do not drag a group anchor", () => {
    const withBystander = computeAutoFocal([
      face(),
      face({ bbox_x: 0.7, quality: 0.5 }),
      face({ bbox_x: 0.02, bbox_y: 0.8, bbox_w: 0.03, bbox_h: 0.03, quality: 0.05 }),
    ]);
    expect(withBystander).toEqual({ x: 65, y: 25.3 });
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
