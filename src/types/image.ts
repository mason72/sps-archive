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
}
