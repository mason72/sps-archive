import { describe, it, expect } from "vitest";
import { reorderWithStacks } from "./reorder";

// A section: Abby's 3 frames as a stack, plus three loose images.
const MEMBERS: Record<string, string[]> = {
  "name:abby": ["a1", "a2", "a3"],
  x1: ["x1"],
  x2: ["x2"],
  x3: ["x3"],
};
const IDS = ["name:abby", "x1", "x2", "x3"];
const expand = (id: string) => MEMBERS[id] ?? [];
const ALL_IMAGES = IDS.flatMap(expand);

/** The invariant that protects the section: nothing lost, nothing duplicated. */
function isPermutationOfAll(result: string[]) {
  return (
    result.length === ALL_IMAGES.length &&
    new Set(result).size === ALL_IMAGES.length &&
    ALL_IMAGES.every((id) => result.includes(id))
  );
}

describe("reorderWithStacks", () => {
  it("moves a whole person in one drag, members staying contiguous", () => {
    const out = reorderWithStacks({
      ids: IDS,
      expand,
      active: "name:abby",
      over: "x3",
      moveSet: ["name:abby"],
    })!;
    expect(out).toEqual(["x1", "x2", "a1", "a2", "a3", "x3"]);
    const first = out.indexOf("a1");
    expect(out.slice(first, first + 3)).toEqual(["a1", "a2", "a3"]);
  });

  it("never loses or duplicates an image, wherever the stack lands", () => {
    for (const over of ["x1", "x2", "x3"]) {
      const out = reorderWithStacks({
        ids: IDS,
        expand,
        active: "name:abby",
        over,
        moveSet: ["name:abby"],
      })!;
      expect(isPermutationOfAll(out)).toBe(true);
    }
  });

  it("moves a loose image past a stack without breaking the stack apart", () => {
    const out = reorderWithStacks({
      ids: IDS,
      expand,
      active: "x3",
      over: "name:abby",
      moveSet: ["x3"],
    })!;
    expect(out).toEqual(["x3", "a1", "a2", "a3", "x1", "x2"]);
    expect(isPermutationOfAll(out)).toBe(true);
  });

  it("keeps a multi-selected block of loose images together", () => {
    const out = reorderWithStacks({
      ids: IDS,
      expand,
      active: "x1",
      over: "name:abby",
      moveSet: ["x1", "x2"],
    })!;
    expect(out).toEqual(["x1", "x2", "a1", "a2", "a3", "x3"]);
    expect(isPermutationOfAll(out)).toBe(true);
  });

  it("is a no-op for a self-drop, a missing target, or a drop inside the move set", () => {
    const base = { ids: IDS, expand, active: "name:abby" };
    expect(reorderWithStacks({ ...base, over: null, moveSet: ["name:abby"] })).toBeNull();
    expect(
      reorderWithStacks({ ...base, over: "name:abby", moveSet: ["name:abby"] })
    ).toBeNull();
    expect(
      reorderWithStacks({
        ids: IDS,
        expand,
        active: "x1",
        over: "x2",
        moveSet: ["x1", "x2"],
      })
    ).toBeNull();
  });

  it("scales the invariant to a realistic headshot section", () => {
    // 40 people x 12 frames, interleaved with 20 loose shots.
    const members: Record<string, string[]> = {};
    const ids: string[] = [];
    for (let p = 0; p < 40; p++) {
      const id = `name:p${p}`;
      members[id] = Array.from({ length: 12 }, (_, f) => `p${p}f${f}`);
      ids.push(id);
    }
    for (let l = 0; l < 20; l++) {
      members[`loose${l}`] = [`loose${l}`];
      ids.push(`loose${l}`);
    }
    const exp = (id: string) => members[id] ?? [];
    const all = ids.flatMap(exp);
    const out = reorderWithStacks({
      ids,
      expand: exp,
      active: "name:p37",
      over: "name:p2",
      moveSet: ["name:p37"],
    })!;
    expect(out.length).toBe(all.length);
    expect(new Set(out).size).toBe(all.length);
    const start = out.indexOf("p37f0");
    expect(out.slice(start, start + 12)).toEqual(members["name:p37"]);
  });
});
