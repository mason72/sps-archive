import { describe, it, expect } from "vitest";
import { shuffleSeeded, sortImages, type SortableImage } from "./sort-images";

const mk = (
  originalFilename: string,
  extra: Partial<SortableImage> = {}
): SortableImage => ({ originalFilename, ...extra });

describe("sortImages — filename", () => {
  it("sorts by the actual filename, case-insensitive", () => {
    const out = sortImages(
      [mk("Banana.jpg"), mk("apple.jpg"), mk("Cherry.jpg")],
      "filename"
    );
    expect(out.map((i) => i.originalFilename)).toEqual([
      "apple.jpg",
      "Banana.jpg",
      "Cherry.jpg",
    ]);
  });

  it("uses plain lexicographic order (img10 before img2, like the public gallery)", () => {
    const out = sortImages(
      [mk("img2.jpg"), mk("img10.jpg"), mk("img1.jpg")],
      "filename"
    );
    expect(out.map((i) => i.originalFilename)).toEqual([
      "img1.jpg",
      "img10.jpg",
      "img2.jpg",
    ]);
  });

  it("REGRESSION: '1...' sorts before '2...' (matches the public gallery order)", () => {
    const out = sortImages(
      [mk("2DUD_0041.jpg"), mk("181108-155310.jpg")],
      "filename"
    );
    expect(out[0].originalFilename).toBe("181108-155310.jpg");
  });
});

describe("sortImages — date-taken", () => {
  it("sorts by takenAt ascending, undated last", () => {
    const out = sortImages(
      [
        mk("c.jpg", { takenAt: null }),
        mk("a.jpg", { takenAt: "2020-01-01" }),
        mk("b.jpg", { takenAt: "2021-06-01" }),
      ],
      "date-taken"
    );
    expect(out.map((i) => i.originalFilename)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });
});

describe("sortImages — upload", () => {
  it("sorts by createdAt ascending when present", () => {
    const out = sortImages(
      [
        mk("b.jpg", { createdAt: "2020-02-01" }),
        mk("a.jpg", { createdAt: "2020-01-01" }),
      ],
      "upload"
    );
    expect(out.map((i) => i.originalFilename)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("preserves input order when createdAt is absent", () => {
    const out = sortImages([mk("b.jpg"), mk("a.jpg")], "upload");
    expect(out.map((i) => i.originalFilename)).toEqual(["b.jpg", "a.jpg"]);
  });

  it("does not mutate the input array", () => {
    const input = [mk("b.jpg"), mk("a.jpg")];
    sortImages(input, "filename");
    expect(input.map((i) => i.originalFilename)).toEqual(["b.jpg", "a.jpg"]);
  });
});

describe("shuffleSeeded", () => {
  const items = Array.from({ length: 40 }, (_, i) => i);

  it("is deterministic for a given seed", () => {
    expect(shuffleSeeded(items, 12345)).toEqual(shuffleSeeded(items, 12345));
  });

  it("differs between seeds", () => {
    expect(shuffleSeeded(items, 1)).not.toEqual(shuffleSeeded(items, 2));
  });

  it("is a true permutation — nothing lost or duplicated", () => {
    const out = shuffleSeeded(items, 999);
    expect(out).toHaveLength(items.length);
    expect([...out].sort((a, b) => a - b)).toEqual(items);
  });

  it("actually reorders (not the identity)", () => {
    expect(shuffleSeeded(items, 7)).not.toEqual(items);
  });

  it("does not mutate the input", () => {
    const copy = [...items];
    shuffleSeeded(items, 3);
    expect(items).toEqual(copy);
  });

  it("handles empty and single-item lists", () => {
    expect(shuffleSeeded([], 5)).toEqual([]);
    expect(shuffleSeeded(["a"], 5)).toEqual(["a"]);
  });

  it("treats seed 0 as valid (no divide-by-zero identity)", () => {
    expect(shuffleSeeded(items, 0)).toHaveLength(items.length);
  });
});
