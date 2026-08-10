import { describe, expect, it } from "vitest";

import { filterSemanticMatches } from "./search-filter";

const m = (similarity: number) => ({ similarity });

describe("filterSemanticMatches", () => {
  it("keeps the ranked slice within 60% of the top score", () => {
    const out = filterSemanticMatches([m(0.13), m(0.1), m(0.08), m(0.07), m(0.05)]);
    // cut = max(0.04, 0.078) → 0.078
    expect(out.map((x) => x.similarity)).toEqual([0.13, 0.1, 0.08]);
  });

  it("a weak-top query collapses to best-efforts instead of a page of noise", () => {
    const out = filterSemanticMatches([m(0.052), m(0.05), m(0.033), m(0.031), m(0.028)]);
    // cut = max(0.04, 0.0312) → 0.04
    expect(out.map((x) => x.similarity)).toEqual([0.052, 0.05]);
  });

  it("everything under the absolute floor vanishes", () => {
    expect(filterSemanticMatches([m(0.035), m(0.02)])).toEqual([]);
  });

  it("the real-but-subtle wedding case survives", () => {
    // "the first dance": top 0.0582 — must NOT come back empty.
    const out = filterSemanticMatches([m(0.0582), m(0.0519), m(0.0491), m(0.03)]);
    expect(out.length).toBe(3);
  });

  it("empty input stays empty", () => {
    expect(filterSemanticMatches([])).toEqual([]);
  });
});
