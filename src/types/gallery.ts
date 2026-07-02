/** Types for the public-facing gallery (client view) */

export interface GalleryImage {
  id: string;
  thumbnailUrl: string;
  /** 800px rendition for srcset — see ImageData.thumbnailLgUrl. */
  thumbnailLgUrl?: string;
  originalUrl?: string;
  originalFilename: string;
  parsedName: string | null;
  width: number | null;
  height: number | null;
  /** "#RRGGBB" loading-placeholder hue (G1); null for pre-pipeline uploads. */
  dominantColor?: string | null;
  takenAt?: string | null;
  downloadUrl?: string;
}

export interface GalleryBranding {
  businessName: string | null;
  logoUrl: string | null;
  website: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  logoPlacement: "left" | "center";
  fontFamily: string;
}

export interface GallerySettings {
  coverEnabled?: boolean;
  coverImageUrl?: string;
  titlePosition?: "above" | "over" | "below";
  titleAlignment?: "left" | "center" | "right";
  titlePlacement?: { vertical: string; horizontal: string };
  headingFont?: string;
  bodyFont?: string;
  /** Event-level color overrides (take precedence over branding) */
  colorPrimary?: string;
  colorSecondary?: string;
  colorAccent?: string;
  colorBackground?: string;
  gridStyle?: "masonry" | "uniform";
  gridColumns?: number;
  gridGap?: "tight" | "normal" | "loose";
  /** The photographer's chosen sort — the public gallery's initial sort mode. */
  gridSort?: "manual" | "upload" | "filename" | "date-taken";
  /** Group same-person photos (by filename) into rotating smart stacks. */
  smartStacks?: boolean;
  /** "You've loved N moments" toasts (event sharing setting; default on). */
  favoriteMilestones?: boolean;
}

export interface GallerySection {
  id: string;
  name: string;
  description: string | null;
  imageIds: string[];
}

export interface GalleryData {
  eventName: string;
  eventDate: string | null;
  customMessage: string | null;
  allowDownload: boolean;
  allowFavorites: boolean;
  requirePinBulk: boolean;
  requirePinIndividual: boolean;
  images: GalleryImage[];
  sections?: GallerySection[];
  shareId: string;
  branding: GalleryBranding | null;
  settings?: GallerySettings;
}
