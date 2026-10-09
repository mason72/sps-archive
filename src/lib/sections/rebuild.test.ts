import { describe, it, expect } from "vitest";
import { rebuildKeepReason, type RebuildCandidate } from "./rebuild";

const plain = (over: Partial<RebuildCandidate> = {}): RebuildCandidate => ({
  name: "C - D",
  locked: false,
  filterQuery: null,
  siteSceneKey: null,
  ...over,
});

describe("rebuildKeepReason", () => {
  it("replaces an ordinary section, whoever made it (Pixieset sets included)", () => {
    expect(rebuildKeepReason(plain())).toBeNull();
    expect(rebuildKeepReason(plain({ name: "FIRST NAME - A - B" }))).toBeNull();
    expect(rebuildKeepReason(plain({ name: "Unsorted" }))).toBeNull();
    expect(rebuildKeepReason(plain({ name: "A–L" }))).toBeNull();
  });

  it("keeps Highlights by name, case-insensitively (migrated HIGHLIGHTS too)", () => {
    expect(rebuildKeepReason(plain({ name: "Highlights" }))).toBe("highlights");
    expect(rebuildKeepReason(plain({ name: " HIGHLIGHTS " }))).toBe("highlights");
  });

  it("keeps locked, smart and website-lane sections", () => {
    expect(rebuildKeepReason(plain({ locked: true }))).toBe("locked");
    expect(rebuildKeepReason(plain({ filterQuery: "people laughing" }))).toBe("smart");
    expect(rebuildKeepReason(plain({ siteSceneKey: "headshots" }))).toBe("site");
  });

  it("treats a null lock as unlocked", () => {
    expect(rebuildKeepReason(plain({ locked: null }))).toBeNull();
  });
});
