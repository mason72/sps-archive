/**
 * User profile types for Pixeltrunk.
 *
 * UserProfile — Account-level metadata & branding
 * Branding   — Business colors, logo placement, typography
 */

export interface UserProfile {
  userId: string;
  displayName: string | null;
  businessName: string | null;
  bio: string | null;
  logoUrl: string | null;
  website: string | null;
  phone: string | null;
  location: string | null;
  branding: Branding;
  galleryDefaults: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  logoPlacement: "left" | "center";
  fontFamily: string;
}

export const DEFAULT_BRANDING: Branding = {
  primaryColor: "#1C1917",
  secondaryColor: "#78716C",
  accentColor: "#10B981",
  backgroundColor: "#FFFFFF",
  logoPlacement: "left",
  fontFamily: "playfair",
};
