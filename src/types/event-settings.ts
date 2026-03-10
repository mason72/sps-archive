export type TitlePosition = "above" | "over" | "below";
export type TitleAlignment = "left" | "center" | "right";
export type TitleVertical = "top" | "center" | "bottom";

export interface TitlePlacement {
  vertical: TitleVertical;
  horizontal: TitleAlignment;
}

export type HeadingFont =
  | "playfair"
  | "inter"
  | "cormorant"
  | "dm-serif"
  | "space-grotesk";

export type BodyFont = "inter" | "source-serif" | "lora" | "dm-sans";

export type GridGap = "tight" | "normal" | "loose";
export type GridStyle = "masonry" | "uniform";

export interface SharingSettings {
  allowDownload: boolean;
  allowFavorites: boolean;
  password: string;
  expiresAt: string;
  customMessage: string;
  requirePinBulk: boolean;
  requirePinIndividual: boolean;
  downloadPin: string;
}

export interface EventSettings {
  cover: {
    enabled: boolean;
    imageId?: string;
    titlePosition: TitlePosition;
    titleAlignment: TitleAlignment;
    titlePlacement?: TitlePlacement;
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
    showFilenames?: boolean;
  };
  sharing: SharingSettings;
}

export const DEFAULT_SHARING_SETTINGS: SharingSettings = {
  allowDownload: true,
  allowFavorites: true,
  password: "",
  expiresAt: "",
  customMessage: "",
  requirePinBulk: false,
  requirePinIndividual: false,
  downloadPin: "",
};

export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  cover: { enabled: false, titlePosition: "over", titleAlignment: "center" },
  typography: { headingFont: "playfair", bodyFont: "inter" },
  color: {
    primary: "#1C1917",
    secondary: "#78716C",
    accent: "#10B981",
    background: "#FFFFFF",
  },
  grid: { columns: 5, gap: "normal", style: "masonry" },
  sharing: DEFAULT_SHARING_SETTINGS,
};

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
