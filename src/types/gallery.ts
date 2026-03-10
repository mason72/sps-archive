/** Types for the public-facing gallery (client view) */

export interface GalleryImage {
  id: string;
  thumbnailUrl: string;
  originalUrl?: string;
  originalFilename: string;
  parsedName: string | null;
  width: number | null;
  height: number | null;
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
  coverLayout?: string;
  coverImageUrl?: string;
  mosaicImageUrls?: string[];
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
