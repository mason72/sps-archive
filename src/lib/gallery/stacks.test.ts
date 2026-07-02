import { describe, it, expect } from "vitest";
import {
  extractPersonName,
  nameBeforeDate,
  stackPersonName,
  buildStacks,
} from "./stacks";
import type { GalleryImage } from "@/types/gallery";

function img(over: Partial<GalleryImage>): GalleryImage {
  return {
    id: Math.random().toString(36).slice(2),
    originalFilename: "photo.jpg",
    parsedName: null,
    thumbnailUrl: "t",
    width: 800,
    height: 600,
    ...over,
  } as GalleryImage;
}

describe("extractPersonName", () => {
  it("splits camel-case into words", () => {
    expect(extractPersonName("JohnSmith_1234.jpg")).toBe("John Smith");
  });

  it("handles date-suffixed filenames", () => {
    expect(extractPersonName("JohnSmith_24-01-30_1234.jpg")).toBe("John Smith");
  });

  it("handles spaces and keeps the name segment", () => {
    expect(extractPersonName("Amber Artis_24-01-30_Booth_527.jpg")).toBe(
      "Amber Artis"
    );
  });

  it("falls back to first underscore segment", () => {
    expect(extractPersonName("Smith_001.jpg")).toBe("Smith");
  });

  it("handles double-dash separators", () => {
    expect(extractPersonName("Jane Doe--042.jpg")).toBe("Jane Doe");
  });
});

describe("stackPersonName", () => {
  it("trims event tokens the upload parser absorbed past the date segment", () => {
    expect(
      stackPersonName(
        img({
          parsedName: "Rushi Sheth CollegeBoardSLC",
          originalFilename: "Rushi Sheth_26-06-24_CollegeBoardSLC_1581.jpg",
        })
      )
    ).toBe("Rushi Sheth");
  });

  it("keeps punctuated parsed names (prefix test fails on the comma)", () => {
    expect(
      stackPersonName(
        img({ parsedName: "Smith, John", originalFilename: "SmithJohn_001.jpg" })
      )
    ).toBe("Smith, John");
  });

  it("never shortens via the underscore-fallback path (no date anchor)", () => {
    expect(
      stackPersonName(
        img({ parsedName: "Smith John", originalFilename: "Smith_John_001.jpg" })
      )
    ).toBe("Smith John");
  });

  it("falls back to filename extraction without a parsed name", () => {
    expect(
      stackPersonName(img({ parsedName: null, originalFilename: "JohnSmith_002.jpg" }))
    ).toBe("John Smith");
  });
});

describe("nameBeforeDate", () => {
  it("answers only when a date/double-dash anchor exists", () => {
    expect(nameBeforeDate("Amber Artis_24-01-30_Booth_527.jpg")).toBe("Amber Artis");
    expect(nameBeforeDate("Smith_John_001.jpg")).toBeNull();
  });
});

describe("buildStacks", () => {
  it("groups by parsedName when present, case-insensitively", () => {
    const images = [
      img({ id: "a", parsedName: "Smith, John" }),
      img({ id: "b", parsedName: "smith, john" }),
      img({ id: "c", parsedName: "Jones, Amy" }),
    ];
    const stacks = buildStacks(images);
    expect(stacks).toHaveLength(2);
    expect(stacks[0].images.map((i) => i.id)).toEqual(["a", "b"]);
    expect(stacks[0].personName).toBe("Smith, John");
  });

  it("falls back to filename-derived names", () => {
    const images = [
      img({ id: "a", originalFilename: "JohnSmith_001.jpg" }),
      img({ id: "b", originalFilename: "JohnSmith_002.jpg" }),
    ];
    const stacks = buildStacks(images);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].personName).toBe("John Smith");
  });

  it("preserves first-appearance order (respects the gallery sort)", () => {
    const images = [
      img({ id: "b1", parsedName: "B" }),
      img({ id: "a1", parsedName: "A" }),
      img({ id: "b2", parsedName: "B" }),
    ];
    const stacks = buildStacks(images);
    expect(stacks.map((s) => s.personName)).toEqual(["B", "A"]);
    expect(stacks[0].images.map((i) => i.id)).toEqual(["b1", "b2"]);
  });

  it("keeps singles as one-image stacks", () => {
    const stacks = buildStacks([img({ id: "solo", parsedName: "Solo" })]);
    expect(stacks).toHaveLength(1);
    expect(stacks[0].images).toHaveLength(1);
  });
});
