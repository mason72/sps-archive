/**
 * Shared image types for Pixeltrunk.
 *
 * ImageData  — Grid-level data returned by the event API
 * ImageDetail — Full metadata (EXIF, scores, tags) fetched lazily by lightbox
 * StackData  — Stack grouping with nested images
 */

/** Base image data returned by GET /api/events/[eventId] */
export interface ImageData {
  id: string;
  r2Key: string;
  thumbnailUrl: string;
  /**
   * 800px rendition for srcset — grids pair it with the 400px thumbnailUrl so
   * the browser picks by tile width × DPR (wide tiles on retina screens need
   * more than 400px or they upscale visibly blurry).
   */
  thumbnailLgUrl?: string;
  /**
   * Full-res URL. Omitted from the event list payload (signed lazily via
   * GET /api/images/[imageId] when the lightbox opens) to keep the list small
   * and halve presigning. Always present on ImageDetail.
   */
  originalUrl?: string;
  originalFilename: string;
  aestheticScore: number | null;
  sharpnessScore: number | null;
  stackId: string | null;
  stackRank: number | null;
  parsedName: string | null;
  processingStatus: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  takenAt: string | null;
  /**
   * Focal point (0–100 percentages, null = unset). Set via the slot-section
   * picker; the website maps it to CSS object-position.
   */
  focalX?: number | null;
  focalY?: number | null;
  /** Website curation: canonical service slug (scene registry), null = unset. */
  service?: string | null;
  /** Website curation: pool scenes rank featured images first. */
  featured?: boolean;
  /**
   * Source event (website-gallery sections hold images that live in other
   * events; captions on the site read the source event's name/city).
   */
  eventId?: string;
  eventName?: string | null;
  eventCity?: string | null;
  /** Ids of every section this image belongs to (junction membership). */
  sectionIds?: string[];
  /**
   * True for the event's cover image. The cover is returned in the payload so
   * the settings sidebar can preview it, but it is excluded from the gallery
   * grid / "All Images" — it's a cover, not a gallery photo.
   */
  isCover?: boolean;
}

/** Full image detail returned by GET /api/images/[imageId] */
export interface ImageDetail extends ImageData {
  takenAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  focalLength: number | null;
  aperture: number | null;
  shutterSpeed: string | null;
  iso: number | null;
  gpsLat: number | null;
  gpsLng: number | null;
  sceneTags: string[] | null;
  isEyesOpen: boolean | null;
  downloadUrl: string;
  /**
   * Face-based focal suggestion (single confident subject, eye level) — the
   * focal picker pre-places its marker here when no focal point is set.
   */
  suggestedFocalX?: number | null;
  suggestedFocalY?: number | null;
}

/** Stack grouping with nested images */
export interface StackData {
  id: string;
  stackType: "face" | "burst" | "similar";
  imageCount: number;
  personName: string | null;
  images: ImageData[];
}

/** Section tab data */
export interface SectionData {
  id: string;
  name: string;
  isAuto: boolean;
  imageCount: number;
  /** Section position within the event (sections.sort_order). */
  sortOrder?: number;
  /** Member image ids in manual (section_images.sort_order) order. */
  imageIds?: string[];
  /** Website scene this section feeds (TDP Website gallery), else null. */
  siteSceneKey?: string | null;
  /** Soft guard: locked sections reject membership/order edits until unlocked. */
  locked?: boolean;
}
