import { describe, it, expect } from "vitest";
import {
  firstScreenImageIds,
  FIRST_SCREEN_MIN_GALLERY,
} from "@/lib/gallery/first-screen";
import { galleryCoverPool } from "@/lib/cover/mosaic";
import type { GallerySettings } from "@/types/gallery";

type Img = {
  id: string;
  parsedName: string | null;
  originalFilename: string;
  mediaType: string;
};
type Section = { id: string; imageIds: string[] };
type CoverSettings = Pick<
  GallerySettings,
  "coverEnabled" | "coverType" | "coverMosaic" | "coverCrossfade"
>;

let seq = 0;
const photo = (person: string | null, mediaType = "image"): Img => {
  const n = String(++seq).padStart(5, "0");
  return {
    id: `p${n}`,
    parsedName: person,
    originalFilename: person ? `${person.replace(" ", "_")}_${n}.jpg` : `IMG_${n}.jpg`,
    mediaType,
  };
};
// Letters only: a name with digits in it is not person-like, so it never stacks.
const alpha = (n: number) => {
  let out = "";
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26);
  } while (n > 0);
  return out;
};
const people = (count: number, shots: number, tag: string) =>
  Array.from({ length: count }, (_, p) => {
    const name = `Guest${alpha(p)} Person${tag.replace(/\d+/g, (d) => alpha(Number(d)))}`;
    return Array.from({ length: shots }, () => photo(name));
  }).flat();

const mosaic = (rows = 3, sectionId?: string): CoverSettings => ({
  coverEnabled: true,
  coverType: "mosaic",
  coverMosaic: { rows, sectionId } as GallerySettings["coverMosaic"],
});

/** What the cover draws from a payload: the function CoverSection runs. */
const coverIds = (images: Img[], sections: Section[], settings: CoverSettings) =>
  (galleryCoverPool({ settings, images, sections })?.pool ?? []).map((i) => i.id);

/** The first part as the route builds it: the same payload, fewer photos. */
const firstPart = (images: Img[], ids: Set<string>) => images.filter((i) => ids.has(i.id));

describe("firstScreenImageIds", () => {
  it("sends a small gallery in one part", () => {
    const images = people(10, 3, "s"); // 30 photos
    const sections = [{ id: "a", imageIds: images.slice(0, 5).map((i) => i.id) }];
    expect(images.length).toBeLessThan(FIRST_SCREEN_MIN_GALLERY);
    expect(firstScreenImageIds({ images, sections, settings: {} })).toBeNull();
  });

  it("sends a gallery without sections in one part", () => {
    const images = people(400, 2, "n");
    expect(firstScreenImageIds({ images, sections: undefined, settings: {} })).toBeNull();
    expect(firstScreenImageIds({ images, sections: [], settings: {} })).toBeNull();
  });

  it("sends the landing section whole, and nothing else without a photo cover", () => {
    const images = people(400, 2, "w");
    const sections = [
      { id: "a", imageIds: images.slice(0, 50).map((i) => i.id) },
      { id: "b", imageIds: images.slice(50).map((i) => i.id) },
    ];
    const ids = firstScreenImageIds({ images, sections, settings: { coverEnabled: false } });
    expect([...(ids ?? [])]).toEqual(sections[0].imageIds);
  });

  it("sends a one-person gallery in one part, so its title cannot change", () => {
    // The page titles a gallery that is ONE stack with the person's name and
    // lays it out flat; from a first part it could not know.
    const images = people(1, 700, "o");
    const sections = [
      { id: "a", imageIds: images.slice(0, 50).map((i) => i.id) },
      { id: "b", imageIds: images.slice(50).map((i) => i.id) },
    ];
    expect(firstScreenImageIds({ images, sections, settings: { smartStacks: true } })).toBeNull();
    // Control: the same gallery with stacks off has no one-person view.
    expect(firstScreenImageIds({ images, sections, settings: { smartStacks: false } })).not.toBeNull();
  });

  it("sends one part when the first screen is most of the gallery", () => {
    const images = people(400, 2, "m");
    const sections = [
      { id: "a", imageIds: images.slice(0, 700).map((i) => i.id) },
      { id: "b", imageIds: images.slice(700).map((i) => i.id) },
    ];
    expect(firstScreenImageIds({ images, sections, settings: {} })).toBeNull();
  });

  it("carries every section the cover rule READS, not only the tiles it picks", () => {
    // L: the landing section, too few people to fill the band.
    // B: 20 people x 3 shots. It stacks, so it has 20 leads, under the 24 a
    //    3-row band needs: it fails.
    // C: 300 people x 2, holding 28 of B's photos (20 people once, 4 twice)
    //    inside its first 500. It fills: the cover comes from C.
    // D: the bulk of the gallery.
    const L = people(1, 5, "L");
    const B = people(20, 3, "B");
    const overlap = [...B.filter((_, i) => i % 3 === 0), ...B.filter((_, i) => i % 3 === 1).slice(0, 4)];
    const Cown = people(286, 2, "C");
    const D = people(1000, 2, "D");
    const images = [...L, ...B, ...Cown, ...D];
    const sections = [
      { id: "L", imageIds: L.map((i) => i.id) },
      { id: "B", imageIds: B.map((i) => i.id) },
      { id: "C", imageIds: [...overlap, ...Cown].map((i) => i.id) },
      { id: "D", imageIds: D.map((i) => i.id) },
    ];
    const settings = mosaic(3);
    const full = coverIds(images, sections, settings);
    expect(galleryCoverPool({ settings, images, sections })?.sectionId).toBe("C");

    // The trap is real: sending only the landing section and the chosen
    // tiles leaves 28 of B's photos, which no longer stack, so B "fills" and
    // the cover would be redrawn from B when the rest arrived.
    const naive = new Set([...sections[0].imageIds, ...full]);
    expect(coverIds(firstPart(images, naive), sections, settings)).not.toEqual(full);

    const ids = firstScreenImageIds({ images, sections, settings });
    expect(ids).not.toBeNull();
    expect(coverIds(firstPart(images, ids!), sections, settings)).toEqual(full);
  });

  it("gives the cover the same pool from the first part as from everything (300 galleries)", () => {
    // Seeded, so a failure names a gallery that can be replayed.
    let state = 0x9e3779b9;
    const rand = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
    let split = 0;
    let checked = 0;

    for (let g = 0; g < 300; g++) {
      // Sections of different kinds: people (stack), camera files (never
      // stack), a few people with many shots, and videos sprinkled in.
      const sectionCount = 2 + Math.floor(rand() * 6);
      const own: Img[][] = [];
      for (let s = 0; s < sectionCount; s++) {
        const kind = pick(["people", "camera", "few", "people"]);
        const size = 5 + Math.floor(rand() * 700);
        const imgs: Img[] =
          kind === "camera"
            ? Array.from({ length: size }, () => photo(null))
            : kind === "few"
              ? people(1 + Math.floor(rand() * 20), Math.max(1, Math.floor(size / 20)), `${g}f${s}`)
              : people(Math.max(1, Math.floor(size / 2)), 1 + Math.floor(rand() * 3), `${g}p${s}`);
        for (const img of imgs) if (rand() < 0.03) img.mediaType = "video";
        own.push(imgs);
      }
      const images = own.flat();
      // Overlap: a Highlights-style section of photos borrowed from the
      // others, dropped in at a random place in the nav.
      const sections: Section[] = own.map((imgs, s) => ({ id: `s${s}`, imageIds: imgs.map((i) => i.id) }));
      if (rand() < 0.6) {
        const borrowed = images.filter(() => rand() < 0.08).map((i) => i.id);
        if (borrowed.length) sections.splice(Math.floor(rand() * 3), 0, { id: "hl", imageIds: borrowed });
      }
      // Sections borrowed into others too, so a later pool can hold an
      // earlier section's photos (the shape of the trap above).
      // (The narrow shape where this matters, a borrowed subset that stops
      // stacking, is built by hand in the test above; random overlap rarely
      // lines it up.)
      if (rand() < 0.5 && sections.length > 2) {
        const donor = sections[1].imageIds.filter(() => rand() < 0.5);
        sections[sections.length - 1].imageIds.unshift(...donor);
      }
      const settings: CoverSettings = pick<CoverSettings>([
        mosaic(1 + Math.floor(rand() * 3)),
        mosaic(1 + Math.floor(rand() * 3), pick(sections).id),
        mosaic(3, "no-such-section"),
        { coverEnabled: true, coverType: "crossfade", coverCrossfade: { count: 6, intervalMs: 5000 } },
        {
          coverEnabled: true,
          coverType: "crossfade",
          coverCrossfade: { sectionId: pick(sections).id, count: 6, intervalMs: 5000 },
        },
        { coverEnabled: true, coverType: "solid" },
      ]);

      const ids = firstScreenImageIds({ images, sections, settings });
      if (!ids) continue;
      split++;
      const head = firstPart(images, ids);
      // The landing section is whole, so its grid is final.
      expect(sections[0].imageIds.every((id) => ids.has(id))).toBe(true);
      // And the cover draws the same photos it will draw from everything.
      expect(coverIds(head, sections, settings), `gallery ${g}`).toEqual(
        coverIds(images, sections, settings)
      );
      checked++;
    }
    // The generator must actually exercise the split, or this proves nothing.
    expect(split).toBeGreaterThan(60);
    expect(checked).toBe(split);
  });
});
