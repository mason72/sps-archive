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
  originalUrl: string;
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
}
