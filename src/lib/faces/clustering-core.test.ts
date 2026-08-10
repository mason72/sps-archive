import { describe, expect, it } from "vitest";

import {
  centroidOf,
  dot,
  planClustering,
  type FaceVec,
  type PersonCentroid,
} from "./clustering-core";

/** Unit vector helpers in 4-dim space — the core is dimension-agnostic. */
const AXIS = {
  a: [1, 0, 0, 0],
  b: [0, 1, 0, 0],
  c: [0, 0, 1, 0],
};
/** Slightly perturbed copy of a unit axis, still ~0.98 similar. */
function near(axis: number[], wobble = 0.2): number[] {
  const v = axis.map((x, i) => x + (i === 3 ? wobble : 0));
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / n);
}

let seq = 0;
function face(embedding: number[], quality = 0.8, personId: string | null = null): FaceVec {
  seq += 1;
  return { id: `f${seq}`, imageId: `i${seq}`, embedding, quality, personId };
}

describe("dot / centroidOf", () => {
  it("dot of identical unit vectors is 1", () => {
    expect(dot(AXIS.a, AXIS.a)).toBeCloseTo(1);
    expect(dot(AXIS.a, AXIS.b)).toBeCloseTo(0);
  });

  it("centroid is re-normalized to unit length", () => {
    const c = centroidOf([AXIS.a, near(AXIS.a)]);
    expect(Math.sqrt(c.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1);
    expect(dot(c, AXIS.a)).toBeGreaterThan(0.99);
  });
});

describe("planClustering", () => {
  const personA: PersonCentroid = {
    id: "person-a",
    name: "Alice",
    centroid: AXIS.a,
    faceCount: 3,
  };

  it("assigns close faces to the existing person, best match wins", () => {
    const personB: PersonCentroid = { id: "person-b", name: null, centroid: AXIS.b, faceCount: 2 };
    const f = face(near(AXIS.a));
    const plan = planClustering([f], [personA, personB]);
    expect(plan.assignments.get(f.id)).toBe("person-a");
    expect(plan.newClusters).toHaveLength(0);
  });

  it("never reassigns an already-assigned face", () => {
    const f = face(near(AXIS.a), 0.9, "person-elsewhere");
    const plan = planClustering([f], [personA]);
    expect(plan.assignments.size).toBe(0);
  });

  it("clusters unmatched faces into new persons by similarity", () => {
    const group1 = [face(near(AXIS.b, 0.1)), face(near(AXIS.b, 0.15)), face(near(AXIS.b, 0.2))];
    const group2 = [face(near(AXIS.c, 0.1)), face(near(AXIS.c, 0.2))];
    const plan = planClustering([...group1, ...group2], [personA]);
    expect(plan.assignments.size).toBe(0);
    expect(plan.newClusters).toHaveLength(2);
    const sizes = plan.newClusters.map((c) => c.length).sort();
    expect(sizes).toEqual([2, 3]);
  });

  it("a lone face stays unassigned instead of becoming a one-face person", () => {
    const f = face(near(AXIS.c));
    const plan = planClustering([f], [personA]);
    expect(plan.newClusters).toHaveLength(0);
    expect(plan.unassigned.map((u) => u.id)).toContain(f.id);
  });

  it("low-quality faces can join a cluster but never seed one", () => {
    const good = [face(near(AXIS.b, 0.1), 0.8), face(near(AXIS.b, 0.15), 0.7)];
    const tiny = face(near(AXIS.b, 0.2), 0.05);
    const lonelyTiny = face(near(AXIS.c), 0.05);
    const plan = planClustering([...good, tiny, lonelyTiny], []);
    expect(plan.newClusters).toHaveLength(1);
    expect(plan.newClusters[0].map((f2) => f2.id)).toContain(tiny.id);
    expect(plan.unassigned.map((u) => u.id)).toContain(lonelyTiny.id);
  });

  it("clusters seed on the highest-quality face", () => {
    const sharp = face(near(AXIS.b, 0.1), 0.95);
    const soft = face(near(AXIS.b, 0.2), 0.3);
    const plan = planClustering([soft, sharp], []);
    expect(plan.newClusters).toHaveLength(1);
    expect(plan.newClusters[0][0].id).toBe(sharp.id);
  });
});
