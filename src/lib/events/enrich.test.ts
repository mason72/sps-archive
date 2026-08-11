import { describe, it, expect } from "vitest";
import { coverImageIdFor } from "./enrich";

describe("coverImageIdFor — archive card thumbnail source", () => {
  it("uses imageId for photo covers", () => {
    expect(
      coverImageIdFor({ settings: { cover: { type: "image", imageId: "img-1" } } })
    ).toBe("img-1");
  });

  it("uses imageId for legacy covers with no type", () => {
    expect(coverImageIdFor({ settings: { cover: { imageId: "img-1" } } })).toBe(
      "img-1"
    );
  });

  it("IGNORES a stale imageId once the cover is a mosaic/color/fade", () => {
    // The reported bug: switching cover type leaves imageId behind, and the
    // card kept rendering the old photo.
    for (const type of ["mosaic", "solid", "crossfade"]) {
      expect(
        coverImageIdFor({ settings: { cover: { type, imageId: "stale-img" } } })
      ).toBeUndefined();
    }
  });

  it("handles missing settings/cover/imageId", () => {
    expect(coverImageIdFor({})).toBeUndefined();
    expect(coverImageIdFor({ settings: {} })).toBeUndefined();
    expect(coverImageIdFor({ settings: { cover: { type: "image" } } })).toBeUndefined();
  });
});
