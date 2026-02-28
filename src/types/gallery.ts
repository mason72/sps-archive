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

export interface GalleryData {
  eventName: string;
  eventDate: string | null;
  customMessage: string | null;
  allowDownload: boolean;
  allowFavorites: boolean;
  requirePinBulk: boolean;
  requirePinIndividual: boolean;
  images: GalleryImage[];
  shareId: string;
  branding: GalleryBranding | null;
}
