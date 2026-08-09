import { describe, it, expect } from "vitest";
import { detectStackable } from "./stackable";

/** Build a set: [personOrPrefix, shots][] → images with that filename shape. */
function set(groups: [string, number][], tag = "Appfolio") {
  const out: { parsedName: string | null; originalFilename: string }[] = [];
  let n = 0;
  for (const [name, shots] of groups) {
    for (let i = 0; i < shots; i++) {
      out.push({
        parsedName: `${name} ${tag}`,
        originalFilename: `${name}_26-08-05_${tag}_${1000 + n++}.jpg`,
      });
    }
  }
  return out;
}

/**
 * Digit-free UNIQUE synthetic names. isPersonLike correctly rejects digits, and
 * a wrapping generator silently merges "singletons" into real groups — which
 * quietly inflates stackedRatio and makes a negative test pass for the wrong
 * reason. Base-26 over three letters gives 17,576 distinct names.
 */
function alphaName(i: number) {
  const L = "abcdefghijklmnopqrstuvwxyz";
  const a = L[Math.floor(i / 676) % 26];
  const b = L[Math.floor(i / 26) % 26];
  const c = L[i % 26];
  const up = (x: string) => x.toUpperCase();
  return `${up(a)}${b}${c}ra ${up(c)}${b}${a}son`;
}

const people = (count: number, shots: number) =>
  set(
    Array.from({ length: count }, (_, i) => [alphaName(i), shots]) as [
      string,
      number
    ][]
  );

describe("detectStackable", () => {
  it("stacks a headshot day (HDC: 314 people, ~17 shots each)", () => {
    const d = detectStackable(people(314, 17));
    expect(d.stackable).toBe(true);
    expect(d.people).toBe(314);
    expect(d.stackedRatio).toBe(1);
  });

  it("stacks a smaller headshot job (Appfolio Goleta: 47 people)", () => {
    expect(detectStackable(people(47, 17)).stackable).toBe(true);
  });

  it("does NOT stack a wedding — the case the obvious metric gets wrong", () => {
    // "Jessica & Koji's Big Day": 1,020 images, 2 filename prefixes. 100% of
    // images sit in a multi-shot group, so a ratio-only test says STACK and the
    // gallery collapses to two tiles. Too few distinct people must veto it.
    const wedding = set([
      ["Jessica Koji", 520],
      ["Getting Ready", 500],
    ]);
    const d = detectStackable(wedding);
    expect(d.stackedRatio).toBe(1); // the trap: looks perfectly stackable
    expect(d.stackable).toBe(false); // …and is correctly rejected
  });

  it("does NOT stack a festival with a handful of giant groups", () => {
    expect(
      detectStackable(set([["Future Of", 380], ["Main Stage", 3]])).stackable
    ).toBe(false);
  });

  it("does NOT stack a photo booth dump (camera-coded, no repeats)", () => {
    const booth = Array.from({ length: 600 }, (_, i) => ({
      parsedName: null,
      originalFilename: `IMG_${4000 + i}.jpg`,
    }));
    expect(detectStackable(booth).stackable).toBe(false);
  });

  it("does NOT stack a mixed portfolio (TDP Website: mostly singletons)", () => {
    // 775 distinct names, ~51% of images in multi-shot groups.
    const mixed = [
      ...people(150, 4),
      ...set(
        Array.from({ length: 600 }, (_, i) => [
          `${alphaName(i + 400)} Solo`,
          1,
        ]) as [string, number][]
      ),
    ];
    const d = detectStackable(mixed);
    expect(d.stackedRatio).toBeLessThan(0.6);
    expect(d.stackable).toBe(false);
  });

  it("rejects a group too large to be one person's shoot", () => {
    // 10 'people' but 200 frames each — that's not a headshot set.
    expect(detectStackable(people(10, 200)).stackable).toBe(false);
  });

  it("is empty-safe and single-image-safe", () => {
    expect(detectStackable([]).stackable).toBe(false);
    expect(
      detectStackable([
        { parsedName: "Solo Person", originalFilename: "Solo Person_1.jpg" },
      ]).stackable
    ).toBe(false);
  });
});
