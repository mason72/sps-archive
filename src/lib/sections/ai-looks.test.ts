import { describe, it, expect } from "vitest";
import {
  AI_LOOKS_JOB_META,
  isAiLooksMeta,
  isAiLooksSection,
  planAiLooksLinks,
} from "./ai-looks";

describe("isAiLooksMeta", () => {
  it("recognises the marker and nothing else", () => {
    expect(isAiLooksMeta(AI_LOOKS_JOB_META)).toBe(true);
    expect(isAiLooksMeta({ kind: "ai-looks", extra: 1 })).toBe(true);
    expect(isAiLooksMeta(null)).toBe(false);
    expect(isAiLooksMeta(undefined)).toBe(false);
    expect(isAiLooksMeta("ai-looks")).toBe(false);
    expect(isAiLooksMeta({ kind: "job" })).toBe(false);
    // A TDP Work job sheet also lives in job_meta; it must never read as AI Looks.
    expect(isAiLooksMeta({ client: "eBay", city: "San Jose" })).toBe(false);
  });
});

describe("isAiLooksSection", () => {
  it("matches by marker first, then by name (case-insensitive, trimmed)", () => {
    expect(isAiLooksSection({ name: "Renders", jobMeta: AI_LOOKS_JOB_META })).toBe(true);
    expect(isAiLooksSection({ name: "AI Looks", jobMeta: null })).toBe(true);
    expect(isAiLooksSection({ name: " ai looks ", jobMeta: undefined })).toBe(true);
    expect(isAiLooksSection({ name: "Highlights", jobMeta: null })).toBe(false);
    expect(isAiLooksSection({ name: "AI", jobMeta: null })).toBe(false);
  });
});

describe("planAiLooksLinks", () => {
  it("links every render into an empty section, in order, from sort_order 0", () => {
    expect(planAiLooksLinks(["a", "b", "c"], [])).toEqual([
      { imageId: "a", sortOrder: 0 },
      { imageId: "b", sortOrder: 1 },
      { imageId: "c", sortOrder: 2 },
    ]);
  });

  it("is idempotent: a second click with nothing new plans nothing", () => {
    const existing = [
      { imageId: "a", sortOrder: 0 },
      { imageId: "b", sortOrder: 1 },
    ];
    expect(planAiLooksLinks(["a", "b"], existing)).toEqual([]);
  });

  it("adds only the renders that landed since, continuing after the current max", () => {
    const existing = [
      { imageId: "a", sortOrder: 0 },
      // A hand-arranged section can have gaps and nulls; continue after the max.
      { imageId: "b", sortOrder: 7 },
      { imageId: "z", sortOrder: null },
    ];
    expect(planAiLooksLinks(["a", "b", "c", "d"], existing)).toEqual([
      { imageId: "c", sortOrder: 8 },
      { imageId: "d", sortOrder: 9 },
    ]);
  });

  it("never plans the same render twice even if the read repeated a row", () => {
    expect(planAiLooksLinks(["a", "a", "b"], [])).toEqual([
      { imageId: "a", sortOrder: 0 },
      { imageId: "b", sortOrder: 1 },
    ]);
  });

  it("removes nothing: members that are no longer renders are left alone", () => {
    // A person may have dragged an ordinary photo into AI Looks. The plan is
    // additive only; it has no delete side.
    const existing = [{ imageId: "hand-picked", sortOrder: 0 }];
    expect(planAiLooksLinks(["r1"], existing)).toEqual([{ imageId: "r1", sortOrder: 1 }]);
  });
});
