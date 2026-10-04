import { describe, expect, it } from "vitest";
import { planSweep } from "./sweep-plan";

const c = (id: string, pending: number) => ({ event_id: id, pending });

describe("planSweep", () => {
  it("stops once the target is covered, keeping the given order", () => {
    const picked = planSweep([c("a", 3000), c("b", 2000), c("c", 500), c("d", 500)], 4000, 1);
    expect(picked).toEqual(["a", "b"]);
  });

  it("wakes the minimum even when the first gallery alone covers the target", () => {
    // The 2026-10-04 shape: one 17,611-photo gallery first in line. Waking only
    // that one would put the whole lane behind it if its runs kept failing.
    const picked = planSweep(
      [c("big", 17611), c("b", 10), c("c", 10), c("d", 10), c("e", 10), c("f", 10)],
      4000,
      5
    );
    expect(picked).toEqual(["big", "b", "c", "d", "e"]);
    // The shipped floor is two: the first in line gets half the lane.
    expect(planSweep([c("big", 17611), c("b", 10), c("c", 10)])).toEqual(["big", "b"]);
  });

  it("takes everything when the backlog is smaller than the target", () => {
    expect(planSweep([c("a", 100), c("b", 50)], 4000, 5)).toEqual(["a", "b"]);
  });

  it("returns nothing for an empty queue", () => {
    expect(planSweep([], 4000, 5)).toEqual([]);
  });

  it("treats an unreadable count as zero rather than stopping early", () => {
    const picked = planSweep(
      [{ event_id: "a", pending: Number.NaN }, c("b", 5000), c("c", 1)],
      4000,
      1
    );
    expect(picked).toEqual(["a", "b"]);
  });
});
