import { describe, it, expect } from "vitest";
import { toDecimalDegrees } from "./parse-filename";

describe("toDecimalDegrees", () => {
  it("converts the real tuple that broke the Perkin Elmer ingest", () => {
    // PE-18-02-13-179.jpg, Canon EOS-1D X Mark II, Scottsdale AZ.
    // Postgres rejected the raw tuple: 22P02 invalid input syntax for
    // type double precision: "[33,38.1798,0]"
    expect(toDecimalDegrees([33, 38.1798, 0], "N", 90)).toBeCloseTo(33.63633, 4);
    expect(toDecimalDegrees([112, 5.5852, 0], "W", 180)).toBeCloseTo(-112.093087, 5);
  });

  it("puts a western longitude in the west", () => {
    // Getting this wrong is worse than having no coordinate: +112 is China.
    const lng = toDecimalDegrees([112, 5.5852, 0], "W", 180)!;
    expect(lng).toBeLessThan(0);
  });

  it("accepts a plain number", () => {
    expect(toDecimalDegrees(37.7749, "N", 90)).toBe(37.7749);
    expect(toDecimalDegrees(-122.4194, undefined, 180)).toBe(-122.4194);
  });

  it("returns null rather than an impossible coordinate", () => {
    expect(toDecimalDegrees([200, 0, 0], "N", 180)).toBeNull();
    expect(toDecimalDegrees([91, 0, 0], "N", 90)).toBeNull();
    expect(toDecimalDegrees(["x", 0, 0], "N", 90)).toBeNull();
    expect(toDecimalDegrees(null, "N", 90)).toBeNull();
    expect(toDecimalDegrees(undefined, undefined, 90)).toBeNull();
    expect(toDecimalDegrees([], "N", 90)).toBeNull();
  });

  it("does not double-negate a pre-signed tuple", () => {
    expect(toDecimalDegrees([-112, 5.5852, 0], "W", 180)).toBeCloseTo(-112.093087, 5);
  });

  it("never returns a non-number for a value the column must accept", () => {
    for (const v of [[33, 38.1798, 0], 37.7749, [0, 0, 0]]) {
      const out = toDecimalDegrees(v, "N", 90);
      expect(out === null || typeof out === "number").toBe(true);
    }
  });
});
