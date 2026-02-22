/**
 * SPS Integration Layer
 *
 * Defines the contract between SimplePhotoShare (spsv2) and SPS Archive.
 * These types represent what we expect to receive from or send to SPS.
 *
 * Integration strategy:
 *   1. Shared Supabase project (same auth, same user accounts)
 *   2. Shared R2 bucket (images stored once, referenced by both)
 *   3. One-click "Archive Event" button in SPS → sends event + images to Archive
 *   4. Archive enhances with AI, sends back stacks/sections/tags to SPS
 */

/** An event imported from SPS */
export interface SPSEventImport {
  /** SPS event ID (preserved for bidirectional sync) */
  spsEventId: string;
  name: string;
  date?: string;
  eventType?: string;
  description?: string;
  /** SPS gallery/collection structure */
  collections?: SPSCollection[];
  /** Images with their SPS metadata */
  images: SPSImageImport[];
}

/** A collection/gallery from SPS */
export interface SPSCollection {
  id: string;
  name: string;
  sortOrder: number;
  imageIds: string[];
}

/** An image imported from SPS */
export interface SPSImageImport {
  /** SPS image ID */
  spsImageId: string;
  /** R2 key (shared storage — no re-upload needed!) */
  r2Key: string;
  originalFilename: string;
  fileSize: number;
  width?: number;
  height?: number;
  mimeType: string;
  /** Any metadata SPS already extracted */
  metadata?: {
    takenAt?: string;
    camera?: string;
    lens?: string;
  };
}

/** What Archive sends back to SPS after processing */
export interface ArchiveEnhancements {
  eventId: string;
  spsEventId: string;
  /** AI-generated sections that SPS can display */
  sections: {
    name: string;
    imageIds: string[];
  }[];
  /** Smart stack groupings */
  stacks: {
    coverImageId: string;
    imageIds: string[];
    personName?: string;
  }[];
  /** Per-image AI metadata */
  imageEnhancements: {
    spsImageId: string;
    sceneTags: string[];
    aestheticScore: number;
    personName?: string;
  }[];
}
