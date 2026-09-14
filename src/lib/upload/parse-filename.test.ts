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
   * The camera rule used to be a bare prefix, so `P` swallowed every name
   * starting with p and `SAM` every Samantha: 5,194 production rows stored
   * parsed_name NULL (measured 2026-09-14). Letter prefixes that begin real
   * names now need digits after them; word prefixes no name starts with
   * still match as a whole word.
   */
  describe("camera prefixes vs names that share their first letters", () => {
    it.each([
      ["Patricia Smith_26-04-14_CollegeBoard_0101.jpg", "Patricia Smith CollegeBoard"],
      ["PatriciaSmith_0101.jpg", "Patricia Smith"],
      ["pete destefano_26-08-06_HDC_0974.jpg", "pete destefano HDC"],
      ["SamanthaGarcia_26-07-14_Appfolio_1338.jpg", "SamanthaGarcia Appfolio"],
      ["Sam Derby_26-08-07_Island_1507.jpg", "Sam Derby Island"],
      ["R0bert Tables-3.jpg", "R0bert Tables"],
      ["Djimon Hounsou-12.jpg", "Djimon Hounsou"],
    ])("reads %s as a person", (file, name) => {
      expect(parseFilename(file).name).toBe(name);
    });

    it.each([
      // Real shapes from the production archive, plus the standard patterns
      // of the bodies each prefix exists for.
      ["IMG_0002.jpg", 2],
      ["IMG_0305-Edit.jpg", null],
      ["IMG_CLASSSY_0005.jpg", 5],
      ["_MG_2686.jpg", 2686],
      ["P0000325.jpg", 325],
      ["P1000123.JPG", 1000123], // Panasonic / Olympus
      ["SAM_0042.JPG", 42], // Samsung
      ["R0012345.JPG", 12345], // Ricoh
      ["DSC_0012.NEF", 12],
      ["DSCF1234.RAF", 1234],
      ["DSCN0001.JPG", 1],
      ["GOPR0001.MP4", 1],
      ["DJI_0001.JPG", 1],
      ["(AI) P1000123.jpg", 1000123],
    ])("treats %s as a camera frame", (file, sequence) => {
      expect(parseFilename(file)).toMatchObject({ name: null, sequence });
    });
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
