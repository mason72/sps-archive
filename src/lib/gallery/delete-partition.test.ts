import { describe, it, expect } from "vitest";
import { partitionSectionDelete } from "./delete-partition";

const counts = (entries: [string, number][]) => new Map(entries);

describe("partitionSectionDelete", () => {
  it("removes the section copy when the image lives in other sections too", () => {
    const r = partitionSectionDelete(
      ["a"],
      counts([["a", 2]]),
      new Set(["a"])
    );
    expect(r).toEqual({ removeFromSection: ["a"], hardDelete: [] });
  });

  it("hard-deletes when this is the image's last section", () => {
    const r = partitionSectionDelete(
      ["a"],
      counts([["a", 1]]),
      new Set(["a"])
    );
    expect(r).toEqual({ removeFromSection: [], hardDelete: ["a"] });
  });

  it("partitions mixed selections per image", () => {
    const r = partitionSectionDelete(
      ["multi", "last", "other"],
      counts([
        ["multi", 3],
        ["last", 1],
        ["other", 2],
      ]),
      new Set(["multi", "last", "other"])
    );
    expect(r.removeFromSection).toEqual(["multi", "other"]);
    expect(r.hardDelete).toEqual(["last"]);
  });

  it("hard-deletes images that are not members of the current section", () => {
    // Stale client state — the gesture degrades to a plain delete.
    const r = partitionSectionDelete(["a"], counts([["a", 5]]), new Set());
    expect(r).toEqual({ removeFromSection: [], hardDelete: ["a"] });
  });

  it("treats unknown membership counts as last-copy", () => {
    const r = partitionSectionDelete(["a"], counts([]), new Set(["a"]));
    expect(r.hardDelete).toEqual(["a"]);
  });
});
