import { galleryCoverPool, MOSAIC_POOL_CAP } from "@/lib/cover/mosaic";
import { buildStacks } from "@/lib/gallery/stacks";
import type { GallerySettings } from "@/types/gallery";

/**
 * The photos a guest sees before they touch anything: the cover's tiles and
 * the section the gallery opens on. The gallery payload is sent in two parts
 * when that is a small slice of a big gallery (`?part=first`, then
 * `?part=rest`), so the page draws in the time it takes to sign and send a
 * few hundred photos instead of all of them (Webex One: 8,248 photos, 1.85 MB
 * compressed, about 3 s on a 5 Mbps phone before anything drew; lesson 200).
 *
 * The first part is the full payload with fewer photos in it: same reads,
 * same settings, same sections (with every id), so nothing the guest sees
 * first can change when the rest lands. That holds because the first part
 * carries every photo the first screen's rules READ, not only the photos
 * they pick:
 *  - the landing section goes WHOLE, so its stacks, counts and order are
 *    computed from all of its photos, exactly as they will be later;
 *  - for a mosaic or crossfade cover, every candidate the pool rule examines
 *    goes in its rule-sized form (the first MOSAIC_POOL_CAP ids of each
 *    section up to and including the one it settled on, or of every section
 *    plus the top of "every photo" when it fell through). Sending only the
 *    chosen tiles is NOT enough: whether a section fills the band depends on
 *    detectStackable, which can flip on a subset, so an earlier section that
 *    fails with all its photos could pass with a few and the cover would
 *    change when the rest arrived.
 * A test re-runs the cover on the first part and compares, and
 * scripts/triage/first-screen-parity.ts does the same on real galleries.
 *
 * Returns null when the gallery goes out in one part: no sections (the grid
 * then stacks across the whole gallery, so no slice of it is final), a small
 * gallery, a gallery of ONE person (the page then titles it with their name
 * and lays it out flat, a verdict it can only reach from every photo), or a
 * first screen that is most of the gallery anyway.
 */

/** Below this many photos, one payload is already quick. */
export const FIRST_SCREEN_MIN_GALLERY = 600;

/** A first part above this share of the gallery saves too little to split. */
export const FIRST_SCREEN_MAX_SHARE = 0.6;

export function firstScreenImageIds<
  T extends {
    id: string;
    parsedName: string | null;
    originalFilename: string;
    mediaType?: string;
  },
>(payload: {
  /** Every displayable photo, in payload order. */
  images: T[];
  /** The sections as the payload sends them: non-empty, in nav order. */
  sections?: { id: string; imageIds: string[] }[];
  settings: Pick<
    GallerySettings,
    "coverEnabled" | "coverType" | "coverMosaic" | "coverCrossfade" | "smartStacks"
  >;
}): Set<string> | null {
  const { images, sections, settings } = payload;
  // SectionedGallery opens on sections[0]; without sections there is no
  // landing slice to send.
  const landing = sections?.[0];
  if (!sections || !landing || images.length < FIRST_SCREEN_MIN_GALLERY) return null;
  // GalleryExperience's singlePerson rule: stacks on, and every photo one stack.
  if (settings.smartStacks && buildStacks(images).length === 1) return null;

  const ids = new Set(landing.imageIds);
  const addHead = (imageIds: string[]) => {
    for (const id of imageIds.slice(0, MOSAIC_POOL_CAP)) ids.add(id);
  };
  // CoverSection renders only when the cover is on.
  const cover = settings.coverEnabled
    ? galleryCoverPool({ settings, images, sections })
    : null;
  if (cover?.source === "chosen") {
    // The chosen section is looked up before anything else is read.
    addHead(sections.find((s) => s.id === cover.sectionId)?.imageIds ?? []);
  } else if (cover?.source === "section") {
    for (const s of sections) {
      addHead(s.imageIds);
      if (s.id === cover.sectionId) break;
    }
  } else if (cover?.source === "all") {
    for (const s of sections) addHead(s.imageIds);
    for (const img of cover.pool) ids.add(img.id);
  }
  if (ids.size > images.length * FIRST_SCREEN_MAX_SHARE) return null;
  return ids;
}
