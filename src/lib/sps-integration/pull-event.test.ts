import { describe, it, expect } from "vitest";
import { isPageDrained, IMPORT_SLICE } from "./pull-event";
import { MANIFEST_PAGE_SIZE } from "./pull-client";

/**
 * The slice walk decides when to advance to the next manifest page. Its failure
 * mode is silent: an off-by-one leaves the tail of every page unimported with no
 * error anywhere, which is exactly the class of bug that costs a photographer
 * frames they think are archived.
 */
describe("isPageDrained", () => {
  it("drains a full SPS page in exactly the expected number of slices", () => {
    const slices = MANIFEST_PAGE_SIZE / IMPORT_SLICE;
    for (let i = 0; i < slices - 1; i++) {
      expect(isPageDrained(i, MANIFEST_PAGE_SIZE)).toBe(false);
    }
    expect(isPageDrained(slices - 1, MANIFEST_PAGE_SIZE)).toBe(true);
  });

  it("treats an empty page as drained by its first slice", () => {
    // Every image on the page was deselected in review — there is nothing to do
    // and the walk must still move on rather than spin.
    expect(isPageDrained(0, 0)).toBe(true);
  });

  it("drains a short page in one slice", () => {
    expect(isPageDrained(0, 1)).toBe(true);
    expect(isPageDrained(0, IMPORT_SLICE - 1)).toBe(true);
    expect(isPageDrained(0, IMPORT_SLICE)).toBe(true);
  });

  it("does NOT drain a page one image longer than a slice", () => {
    // The off-by-one that would silently drop that one image.
    expect(isPageDrained(0, IMPORT_SLICE + 1)).toBe(false);
    expect(isPageDrained(1, IMPORT_SLICE + 1)).toBe(true);
  });

  it("covers every image for every page size up to a full page", () => {
    // Property check: walking slices until drained must visit at least pageSize
    // images, for every possible page size. This is the assertion that would
    // have caught a `>` instead of `>=`.
    for (let pageSize = 0; pageSize <= MANIFEST_PAGE_SIZE; pageSize++) {
      let sliceIndex = 0;
      while (!isPageDrained(sliceIndex, pageSize)) {
        sliceIndex++;
        if (sliceIndex > 1000) throw new Error(`never drained at ${pageSize}`);
      }
      const covered = (sliceIndex + 1) * IMPORT_SLICE;
      expect(covered).toBeGreaterThanOrEqual(pageSize);
    }
  });
});
