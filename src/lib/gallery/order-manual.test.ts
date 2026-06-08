import { describe, it, expect } from "vitest";
import {
  orderBySectionManual,
  orderByPrimarySection,
  type ManualSection,
} from "./order-manual";

const img = (id: string) => ({ id });

describe("orderBySectionManual", () => {
  it("orders images by the explicit id list", () => {
    const out = orderBySectionManual(
      [img("a"), img("b"), img("c")],
      ["c", "a", "b"]
    );
    expect(out.map((i) => i.id)).toEqual(["c", "a", "b"]);
  });

  it("is independent of input order", () => {
    const out = orderBySectionManual(
      [img("b"), img("c"), img("a")],
      ["a", "b", "c"]
    );
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("sinks images missing from the order list to the end, by id", () => {
    const out = orderBySectionManual(
      [img("z"), img("a"), img("x")],
      ["a"]
    );
    expect(out.map((i) => i.id)).toEqual(["a", "x", "z"]);
  });

  it("does not mutate the input array", () => {
    const input = [img("b"), img("a")];
    orderBySectionManual(input, ["a", "b"]);
    expect(input.map((i) => i.id)).toEqual(["b", "a"]);
  });
});

describe("orderByPrimarySection (All Images reflection)", () => {
  const sections: ManualSection[] = [
    { id: "s1", sortOrder: 0, imageIds: ["a", "b"] },
    { id: "s2", sortOrder: 1, imageIds: ["c", "d"] },
  ];

  it("orders by section position then in-section order", () => {
    const out = orderByPrimarySection(
      [img("d"), img("a"), img("c"), img("b")],
      sections
    );
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("respects section sortOrder regardless of array order", () => {
    const reordered: ManualSection[] = [
      { id: "s2", sortOrder: 1, imageIds: ["c"] },
      { id: "s1", sortOrder: 0, imageIds: ["a"] },
    ];
    const out = orderByPrimarySection([img("c"), img("a")], reordered);
    expect(out.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("places a multi-section image under its lowest-sort_order (primary) section", () => {
    // 'shared' is in both s1 (pos 1) and s2 (pos 0); primary = s1.
    const multi: ManualSection[] = [
      { id: "s1", sortOrder: 0, imageIds: ["a", "shared"] },
      { id: "s2", sortOrder: 1, imageIds: ["shared", "c"] },
    ];
    const out = orderByPrimarySection(
      [img("c"), img("shared"), img("a")],
      multi
    );
    // a, shared (from s1), then c (s2). shared appears once, under s1.
    expect(out.map((i) => i.id)).toEqual(["a", "shared", "c"]);
  });

  it("sinks images in no section to the end, ordered by id", () => {
    const out = orderByPrimarySection(
      [img("orphan2"), img("a"), img("orphan1")],
      [{ id: "s1", sortOrder: 0, imageIds: ["a"] }]
    );
    expect(out.map((i) => i.id)).toEqual(["a", "orphan1", "orphan2"]);
  });
});
