/** Result from CLIP embedding generation */
export interface ClipEmbeddingResult {
  imageId: string;
  embedding: number[]; // 768-dim vector
  sceneTags: string[]; // zero-shot classified scene tags
}

/** Result from face detection + embedding */
export interface FaceDetectionResult {
  imageId: string;
  faces: {
    bbox: { x: number; y: number; w: number; h: number };
    embedding: number[]; // 512-dim ArcFace vector
    isEyesOpen: boolean;
    quality: number; // 0-1 face quality score
  }[];
}

/** Result from aesthetic scoring */
export interface AestheticScoreResult {
  imageId: string;
  aestheticScore: number; // 0-1 overall quality
  sharpnessScore: number; // 0-1 sharpness
  exposureScore: number; // 0-1 exposure quality
}

/** Combined AI processing result for a single image */
export interface ImageProcessingResult {
  imageId: string;
  clip: ClipEmbeddingResult;
  faces: FaceDetectionResult;
  aesthetic: AestheticScoreResult;
}

/** Processing job payload sent to Modal */
export interface ProcessingJob {
  imageId: string;
  r2Key: string;
  eventId: string;
  downloadUrl: string;
}

/** Scene categories for zero-shot classification */
export const SCENE_CATEGORIES = [
  // Wedding
  "ceremony",
  "reception",
  "first-dance",
  "speeches",
  "getting-ready",
  "bridal-party",
  "cake-cutting",
  "bouquet-toss",
  "first-look",
  // General event
  "group-photo",
  "candid",
  "portrait",
  "detail-shot",
  "landscape",
  "food",
  "venue",
  "decoration",
  // Corporate / Headshot
  "headshot",
  "presentation",
  "networking",
  "panel",
  // General
  "outdoor",
  "indoor",
  "night",
  "golden-hour",
] as const;

export type SceneCategory = (typeof SCENE_CATEGORIES)[number];
