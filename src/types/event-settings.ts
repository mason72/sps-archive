export type CoverLayout =
  | "center"
  | "love"
  | "left"
  | "novel"
  | "vintage"
  | "frame"
  | "stripe"
  | "divider"
  | "journal"
  | "stamp"
  | "outline"
  | "classic";

export type HeadingFont =
  | "playfair"
  | "inter"
  | "cormorant"
  | "dm-serif"
  | "space-grotesk";

export type BodyFont = "inter" | "source-serif" | "lora" | "dm-sans";

export type GridGap = "tight" | "normal" | "loose";
export type GridStyle = "masonry" | "uniform";

export interface EventSettings {
  cover: {
    layout: CoverLayout;
  };
  typography: {
    headingFont: HeadingFont;
    bodyFont: BodyFont;
  };
  color: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  grid: {
    columns: number;
    gap: GridGap;
    style: GridStyle;
  };
}

export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  cover: { layout: "center" },
  typography: { headingFont: "playfair", bodyFont: "inter" },
  color: {
    primary: "#1C1917",
    secondary: "#78716C",
    accent: "#10B981",
    background: "#FFFFFF",
  },
  grid: { columns: 5, gap: "normal", style: "masonry" },
};

export const COVER_LAYOUTS: { value: CoverLayout; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "love", label: "Love" },
  { value: "left", label: "Left" },
  { value: "novel", label: "Novel" },
  { value: "vintage", label: "Vintage" },
  { value: "frame", label: "Frame" },
  { value: "stripe", label: "Stripe" },
  { value: "divider", label: "Divider" },
  { value: "journal", label: "Journal" },
  { value: "stamp", label: "Stamp" },
  { value: "outline", label: "Outline" },
  { value: "classic", label: "Classic" },
];

export const HEADING_FONTS: { value: HeadingFont; label: string }[] = [
  { value: "playfair", label: "Playfair Display" },
  { value: "inter", label: "Inter" },
  { value: "cormorant", label: "Cormorant Garamond" },
  { value: "dm-serif", label: "DM Serif Display" },
  { value: "space-grotesk", label: "Space Grotesk" },
];

export const BODY_FONTS: { value: BodyFont; label: string }[] = [
  { value: "inter", label: "Inter" },
  { value: "source-serif", label: "Source Serif Pro" },
  { value: "lora", label: "Lora" },
  { value: "dm-sans", label: "DM Sans" },
];
