import { describe, it, expect } from "vitest";
import { parseFilename } from "./parse-filename";

describe("parseFilename", () => {
  it("reads a person's name and a trailing sequence", () => {
    expect(parseFilename("John Smith-001.jpg")).toMatchObject({
      name: "John Smith",
      sequence: 1,
      extension: "jpg",
    });
  });

  it("treats camera-generated names as nameless", () => {
    expect(parseFilename("IMG_4532.jpg")).toMatchObject({ name: null, sequence: 4532 });
  });

  /**
   * SPS names an AI-styled render "(AI) <original filename>". The prefix is
   * provenance, not a name — parsed as-is it minted "(AI) Justin Smith" as a
   * second person on /people, standing beside Justin Smith. The renders
   * started coming across on 2026-09-02; this is what keeps them on the
   * right person's card.
   */
  it("strips SPS's '(AI) ' render prefix from the derived name", () => {
    const render = parseFilename("(AI) Justin Smith.jpg");
    const capture = parseFilename("Justin Smith.jpg");
    expect(render.name).toBe(capture.name);
    expect(render.name).toBe("Justin Smith");
    expect(render.stem).toBe("Justin Smith");
    expect(render.extension).toBe("jpg");
  });

  it("still sees a camera name under the render prefix", () => {
    // A render of an unrenamed frame is a render of nobody in particular.
    expect(parseFilename("(AI) IMG_1234.jpg").name).toBeNull();
  });

  it("does not strip '(AI)' from the middle of a name", () => {
    // Only the leading marker is SPS's; anything else is the photographer's.
    expect(parseFilename("Team (AI) Lab-3.jpg").name).toContain("AI");
  });
});
