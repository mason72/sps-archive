import { describe, it, expect } from "vitest";
import { detectNaming, planAutoSections, type PlanImage } from "./auto-plan";

/** Build a realistic headshot PlanImage: "First Last_YY-MM-DD_TAG####.jpg". */
let seq = 0;
function shot(first: string, last: string, tag = "EVT"): PlanImage {
  const n = String(1000 + seq++).slice(-4);
  const original = `${first} ${last}_26-03-17_${tag}${n}.jpg`;
  // parsed_name is polluted with the trailing tag (as the real parser does).
  return { id: `${first}-${last}-${n}`, parsedName: `${first} ${last} ${tag}${n}`, originalFilename: original };
}

/** N shots of one person. */
function person(first: string, last: string, count: number): PlanImage[] {
  return Array.from({ length: count }, () => shot(first, last));
}

describe("detectNaming", () => {
  it("flags a big headshot set as person-named → letter mode", () => {
    const firsts = [
      "Aaron", "Bianca", "Carla", "Dana", "Evan", "Fiona", "Gabe", "Hana",
      "Ivan", "Julia", "Kevin", "Lena", "Marco", "Nina", "Oscar", "Paula",
      "Quinn", "Rosa", "Sam", "Tara", "Uma", "Vera", "Will", "Xena", "Yara",
      "Zane", "Amy", "Ben",
    ]; // 28 distinct, clean, span A–Z
    const imgs = firsts.flatMap((f) => person(f, "Doe", 10));
    const d = detectNaming(imgs);
    expect(d.personNamed).toBe(true);
    expect(d.distinctPeople).toBe(28);
    expect(d.suggestedMode).toBe("letter");
  });

  it("suggests per-person for a small named job", () => {
    const imgs = [
      ...person("Aaron", "Adams", 8),
      ...person("Bianca", "Bell", 6),
      ...person("Carla", "Cruz", 7),
    ];
    const d = detectNaming(imgs);
    expect(d.personNamed).toBe(true);
    expect(d.distinctPeople).toBe(3);
    expect(d.suggestedMode).toBe("per-person");
  });

  it("falls back to even split for non-person filenames", () => {
    const imgs = ["JRM7521", "VTVFMTE3UDY1", "WACA27832", "IMG_0001", "DSC_9987"].map(
      (code, i) => ({ id: `c${i}`, parsedName: code, originalFilename: `${code}.jpg` })
    );
    const d = detectNaming(imgs);
    expect(d.personNamed).toBe(false);
    expect(d.suggestedMode).toBe("even");
  });
});

describe("planAutoSections — letter mode", () => {
  it("buckets consecutive letters to the target and never splits a letter", () => {
    const imgs = [
      ...person("Aaron", "A", 200), // A: 200
      ...person("Bea", "B", 100), // B: 100
      ...person("Cara", "C", 250), // C: 250
      ...person("Dana", "D", 90), // D: 90
    ];
    const sections = planAutoSections(imgs, { mode: "letter", target: 300 });
    // Greedy: A(200)+B(100)=300 → "A–B"; C(250)+D(90)=340>300 so C alone, then D.
    expect(sections.map((s) => s.name)).toEqual(["A–B", "C", "D"]);
    expect(sections[0].imageIds.length).toBe(300);
    expect(sections[1].imageIds.length).toBe(250);
    expect(sections[2].imageIds.length).toBe(90);
    // No image lost or duplicated.
    const all = sections.flatMap((s) => s.imageIds);
    expect(new Set(all).size).toBe(640);
  });

  it("keeps a single over-target letter whole in its own section", () => {
    const imgs = [...person("Aaron", "A", 400), ...person("Bea", "B", 50)];
    const sections = planAutoSections(imgs, { mode: "letter", target: 300 });
    expect(sections.map((s) => s.name)).toEqual(["A", "B"]);
    expect(sections[0].imageIds.length).toBe(400); // whole letter, oversized
  });

  it("counts PEOPLE not images when stacks is on", () => {
    // 60 distinct people under A (10 shots each), 30 under B; target 50 people.
    const clean = (prefix: string, i: number) =>
      prefix + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26));
    const imgs = [
      ...Array.from({ length: 60 }, (_, i) => person(clean("A", i), "Doe", 10)).flat(),
      ...Array.from({ length: 30 }, (_, i) => person(clean("B", i), "Doe", 10)).flat(),
    ];
    const sections = planAutoSections(imgs, { mode: "letter", target: 50, stacks: true });
    // A alone = 60 people > 50 → its own section; B = 30 → its own.
    expect(sections.map((s) => s.name)).toEqual(["A", "B"]);
    expect(sections[0].people).toBe(60);
    expect(sections[1].people).toBe(30);
  });

  it("sorts names alphabetically within a section", () => {
    const imgs = [shot("Carla", "Z"), shot("Aaron", "Y"), shot("Bea", "X")];
    const [section] = planAutoSections(imgs, { mode: "letter", target: 300 });
    expect(section.name).toBe("A–C");
    expect(section.imageIds).toEqual([
      imgs[1].id, // Aaron
      imgs[2].id, // Bea
      imgs[0].id, // Carla
    ]);
  });
});

describe("planAutoSections — per-person mode", () => {
  it("makes one section per person, alphabetical", () => {
    const imgs = [...person("Bea", "Bell", 3), ...person("Aaron", "Adams", 2)];
    const sections = planAutoSections(imgs, { mode: "per-person", target: 1 });
    expect(sections.map((s) => s.name)).toEqual(["Aaron Adams", "Bea Bell"]);
    expect(sections[0].imageIds.length).toBe(2);
    expect(sections[1].imageIds.length).toBe(3);
  });
});

describe("planAutoSections — even mode", () => {
  it("splits into approximately even sets by target", () => {
    const imgs = Array.from({ length: 250 }, (_, i) => ({
      id: `img${i}`,
      originalFilename: `DSC_${i}.jpg`,
    }));
    const sections = planAutoSections(imgs, { mode: "even", target: 100 });
    expect(sections.length).toBe(3); // ceil(250/100)
    expect(sections.map((s) => s.name)).toEqual(["Set 1", "Set 2", "Set 3"]);
    const total = sections.reduce((n, s) => n + s.imageIds.length, 0);
    expect(total).toBe(250);
    // Even-ish: no section wildly larger than another.
    const sizes = sections.map((s) => s.imageIds.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1 + 84); // 84,84,82
  });
});

describe("planAutoSections — mixed / unmatched", () => {
  it("routes non-person names to a Misc section (letter mode)", () => {
    const imgs = [
      ...person("Aaron", "Adams", 5),
      { id: "x1", parsedName: "2Dudes WF", originalFilename: "2Dudes_WF_0111.jpg" },
      { id: "x2", parsedName: "JRM7521", originalFilename: "_JRM7521.jpg" },
    ];
    const sections = planAutoSections(imgs, { mode: "letter", target: 300 });
    const misc = sections.find((s) => s.name === "Misc");
    expect(misc).toBeTruthy();
    // "2Dudes..." starts with a digit → Misc; "JRM7521" single token → Misc.
    expect(misc!.imageIds.sort()).toEqual(["x1", "x2"]);
    expect(sections.find((s) => s.name === "A")!.imageIds.length).toBe(5);
  });

  it("is deterministic — same input, identical output", () => {
    const imgs = [
      ...person("Cara", "C", 40),
      ...person("Aaron", "A", 60),
      ...person("Bea", "B", 30),
    ];
    const a = planAutoSections(imgs, { mode: "letter", target: 80 });
    const b = planAutoSections(imgs, { mode: "letter", target: 80 });
    expect(a).toEqual(b);
  });
});
