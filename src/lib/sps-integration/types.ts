/**
 * The SimplePhotoShare ↔ Pixeltrunk contract.
 *
 * Two directions, and they are not symmetrical:
 *
 *  - **Pull (SPS → archive).** Pixeltrunk asks SPS for a finished event's camera
 *    files and moves the bytes. Types live in `pull-client.ts`, next to the
 *    only code that speaks that protocol. Contract:
 *    `tasks/sps-archive-pull-spec.md`.
 *  - **Enhancements (archive → SPS).** After AI processing, SPS can read back
 *    sections, stacks and per-image tags to enrich its own gallery. That is what
 *    this file describes.
 *
 * This file used to also describe a PUSH import ("SPS sends event + image
 * metadata, archive mints rows pointing at the same R2 keys") on the stated
 * premise of a shared bucket. There is no shared bucket — SPS serves from
 * `pub-7363d57d….r2.dev`, the archive stores in `sps-prism` — so those types
 * described an import that could only produce unreadable tiles. Deleted
 * 2026-08-11 along with the route and the importer that used them.
 */

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
