import { describe, it, expect } from "vitest";
import {
  resolveShareImageScope,
  shareScopeIdFilter,
  shareScopeIsEmpty,
} from "./share-scope";

describe("resolveShareImageScope", () => {
  it("serves the whole event for a full share", () => {
    expect(resolveShareImageScope({ share_type: "full", image_ids: null })).toEqual({
      kind: "event",
    });
  });

  it("narrows a selection to its own ids", () => {
    expect(
      resolveShareImageScope({ share_type: "selection", image_ids: ["a", "b"] })
    ).toEqual({ kind: "images", imageIds: ["a", "b"] });
  });

  // The bug this module exists for: every reader special-cased "selection",
  // so any OTHER type fell through to the unfiltered whole-event query.
  it.each(["section", "person", "", "FULL", "unknown-future-type"])(
    "fails closed for share_type %j",
    (share_type) => {
      expect(resolveShareImageScope({ share_type, image_ids: null })).toEqual({
        kind: "none",
      });
    }
  );

  it("fails closed for a section share that carries image_ids", () => {
    expect(
      resolveShareImageScope({ share_type: "section", image_ids: ["a"] })
    ).toEqual({ kind: "none" });
  });

  it("treats a selection with no ids as nothing, not everything", () => {
    expect(
      resolveShareImageScope({ share_type: "selection", image_ids: [] })
    ).toEqual({ kind: "none" });
    expect(
      resolveShareImageScope({ share_type: "selection", image_ids: null })
    ).toEqual({ kind: "none" });
  });
});

describe("shareScopeIdFilter", () => {
  it("returns null (no filter) only for a full share", () => {
    expect(shareScopeIdFilter({ kind: "event" })).toBeNull();
  });

  it("returns the selection's ids", () => {
    expect(shareScopeIdFilter({ kind: "images", imageIds: ["a"] })).toEqual(
      new Set(["a"])
    );
  });

  // The safety property: a caller that forgets the explicit deny branch and
  // just filters by this set still shows nothing.
  it("returns an empty set for a denied scope", () => {
    const filter = shareScopeIdFilter({ kind: "none" });
    expect(filter).toEqual(new Set());
    expect(filter?.has("any-image-id")).toBe(false);
  });
});

describe("shareScopeIsEmpty", () => {
  it("is true only for the denied scope", () => {
    expect(shareScopeIsEmpty({ kind: "none" })).toBe(true);
    expect(shareScopeIsEmpty({ kind: "event" })).toBe(false);
    expect(shareScopeIsEmpty({ kind: "images", imageIds: ["a"] })).toBe(false);
  });
});
