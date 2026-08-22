import { describe, it, expect } from "vitest";
import { applyFaceCountRule, faceCountRule } from "./face-count-query";

describe("faceCountRule", () => {
  it("group words mean two or more faces", () => {
    for (const q of ["group", "Group photos", "group shot", "the team", "people together"]) {
      expect(faceCountRule(q)).toMatchObject({ min: 2 });
      expect(faceCountRule(q)?.max).toBeUndefined();
    }
  });
  it("pair words mean exactly two", () => {
    expect(faceCountRule("two people")).toMatchObject({ min: 2, max: 2 });
    expect(faceCountRule("a couple")).toMatchObject({ min: 2, max: 2 });
  });
  it("crowd words mean five or more", () => {
    expect(faceCountRule("crowd")).toMatchObject({ min: 5 });
    expect(faceCountRule("whole team")).toMatchObject({ min: 5 });
    expect(faceCountRule("everyone")).toMatchObject({ min: 5 });
  });
  it("ordinary descriptions are not structural", () => {
    for (const q of ["candid laughing", "glasses", "on stage", "groupie"]) {
      expect(faceCountRule(q)).toBeNull();
    }
  });
  it("applies the range", () => {
    const rows = [0, 1, 2, 3, 5, 9].map((n) => ({ id: String(n), face_count: n }));
    expect(applyFaceCountRule(rows, faceCountRule("group")!).map((r) => r.id)).toEqual(["2", "3", "5", "9"]);
    expect(applyFaceCountRule(rows, faceCountRule("two people")!).map((r) => r.id)).toEqual(["2"]);
    expect(applyFaceCountRule(rows, faceCountRule("crowd")!).map((r) => r.id)).toEqual(["5", "9"]);
  });
});
