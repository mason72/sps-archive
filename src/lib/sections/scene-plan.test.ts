import { describe, expect, it } from "vitest";

import { assignScenes, CATCH_ALL_NAME } from "./scene-plan";

const LABELS = ["Ceremony", "Reception", "Cake"];

function simsOf(entries: Record<string, number[]>) {
  return new Map(Object.entries(entries));
}

/** N distinct images all scoring the same way (to clear MIN_SCENE_MEMBERS). */
function bulk(prefix: string, n: number, byLabel: number[]) {
  const out: Record<string, number[]> = {};
  for (let i = 0; i < n; i++) out[`${prefix}${i}`] = byLabel;
  return out;
}

describe("assignScenes", () => {
  it("each group lands with the label it distinctly matches", () => {
    const plan = assignScenes(
      simsOf({
        ...bulk("cer", 5, [0.12, 0.06, 0.05]),
        ...bulk("rec", 5, [0.06, 0.12, 0.05]),
        ...bulk("cake", 5, [0.05, 0.06, 0.12]),
      }),
      LABELS
    );
    const byName = new Map(plan.map((s) => [s.name, s.imageIds.length]));
    expect(byName.get("Ceremony")).toBe(5);
    expect(byName.get("Reception")).toBe(5);
    expect(byName.get("Cake")).toBe(5);
  });

  it("REGRESSION: a uniformly-warm generic label cannot swallow the event", () => {
    // "Reception" scores 0.10 on EVERYTHING (the Portraits-at-a-wedding
    // failure); Ceremony/Cake are strong only on their true subsets. After
    // per-label mean-centering the generic label claims nothing exclusive.
    const plan = assignScenes(
      simsOf({
        ...bulk("cer", 6, [0.13, 0.1, 0.05]),
        ...bulk("cake", 6, [0.05, 0.1, 0.13]),
      }),
      LABELS
    );
    const byName = new Map(plan.map((s) => [s.name, s.imageIds.length]));
    expect(byName.get("Ceremony")).toBe(6);
    expect(byName.get("Cake")).toBe(6);
    // The generic label's adjusted score is 0 everywhere — never within
    // margin of the true label's strong positive adjustment.
    expect(byName.get("Reception")).toBeUndefined();
  });

  it("genuinely ambiguous images join both scenes (multi-membership)", () => {
    const plan = assignScenes(
      simsOf({
        ...bulk("cer", 5, [0.13, 0.05, 0.05]),
        ...bulk("cake", 5, [0.05, 0.05, 0.13]),
        ...bulk("both", 4, [0.13, 0.05, 0.13]), // cake-cutting during ceremony-ish
      }),
      LABELS
    );
    const byName = new Map(plan.map((s) => [s.name, s.imageIds]));
    expect(byName.get("Ceremony")).toHaveLength(9);
    expect(byName.get("Cake")).toHaveLength(9);
  });

  it("weak images land in the catch-all (full coverage always)", () => {
    const plan = assignScenes(
      simsOf({
        ...bulk("good", 4, [0.12, 0.02, 0.02]),
        weak1: [0.03, 0.02, 0.01],
        weak2: [0.01, 0.01, 0.01],
      }),
      LABELS
    );
    const catchAll = plan.find((s) => s.name === CATCH_ALL_NAME);
    expect(catchAll?.imageIds.sort()).toEqual(["weak1", "weak2"]);
    const total = new Set(plan.flatMap((s) => s.imageIds));
    expect(total.size).toBe(6);
  });

  it("drops thin scenes; their images fall back unless covered elsewhere", () => {
    const plan = assignScenes(
      simsOf({
        ...bulk("cer", 6, [0.12, 0.02, 0.02]),
        lonelyCake: [0.02, 0.02, 0.2], // only member of Cake → dropped → catch-all
      }),
      LABELS
    );
    expect(plan.find((s) => s.name === "Cake")).toBeUndefined();
    expect(plan.find((s) => s.name === CATCH_ALL_NAME)?.imageIds).toEqual(["lonelyCake"]);
  });

  it("sections come back in taxonomy order", () => {
    const plan = assignScenes(
      simsOf({
        ...bulk("cake", 4, [0.02, 0.02, 0.13]),
        ...bulk("cer", 4, [0.13, 0.02, 0.02]),
      }),
      LABELS
    );
    expect(plan.map((s) => s.name)).toEqual(["Ceremony", "Cake"]);
  });
});
