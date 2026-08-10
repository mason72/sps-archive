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
  /** "You've loved N moments" toasts — off for corporate-flavored galleries. */
  favoriteMilestones?: boolean;
  /** Guests can search the gallery by description (semantic). Default on. */
  guestSearch?: boolean;
  /**
   * Guests can find their own photos with a selfie. OPT-IN (default off) —
   * biometric-adjacent, so the photographer flips it per event deliberately
   * (decided 2026-08-09). The selfie is embedded in memory and never stored.
   */
  selfieSearch?: boolean;
  password: string;
  expiresAt: string;
  customMessage: string;
  requirePinBulk: boolean;
  requirePinIndividual: boolean;
  downloadPin: string;
}

export type CoverType = "image" | "mosaic" | "solid" | "crossfade";

/** Normalized crop anchor, 0–1 in both axes. {0.5, 0.5} = center. */
export interface FocalPoint {
  x: number;
  y: number;
}

export type MosaicLogoMode = "none" | "overlay" | "insert";

export interface MosaicCoverSettings {
  /** Source section for tiles. Undefined → the event's first section. */
  sectionId?: string;
  /** Tile density: the band height is fixed, rows set the tile size. */
  rows: 2 | 3 | 4;
  /** Deterministic arrangement; "Shuffle" in the editor rerolls this. */
  seed: number;
  logoMode: MosaicLogoMode;
  /** R2 key of the per-event client logo (distinct from photographer branding). */
  logoKey?: string;
  /** Overlay mode: color wash across all tiles, logo centered on top. */
  overlay: { color: string; opacity: number; blur: boolean };
  /** Insert mode: empty box in the mosaic's center holding the logo. */
  insert: { padding: number; fill: string };
}

export interface SolidCoverSettings {
  logoKey?: string;
  /** Whitespace around the logo, % of band height (0–45). */
  padding: number;
  /** 1 color = solid fill, 2+ = linear gradient (spsv2-style). */
  colors: string[];
  /** Gradient angle in degrees; ignored for a single color. */
  angle: number;
}

export interface CrossfadeCoverSettings {
  /** Source section for the rotation. Undefined → the event's first section. */
  sectionId?: string;
  /** How many images to cycle through. */
  count: number;
  /** Ms each image holds before the next fade begins. */
  intervalMs: number;
}

export interface CoverSettings {
  enabled: boolean;
  /** Legacy rows have no type — normalize to "image". */
  type: CoverType;
  imageId?: string;
  /** Crop anchor for image/crossfade covers (hero + OG crops). */
  focalPoint?: FocalPoint;
  mosaic?: MosaicCoverSettings;
  solid?: SolidCoverSettings;
  crossfade?: CrossfadeCoverSettings;
  titlePosition: TitlePosition;
  titleAlignment: TitleAlignment;
  titlePlacement?: TitlePlacement;
  /**
   * Suppress the event title on the cover. Unset = auto: hidden when a
   * client logo is shown (the logo IS the title), visible otherwise.
   */
  hideTitle?: boolean;
}

export interface EventSettings {
  cover: CoverSettings;
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
    sortBy?: "upload" | "filename" | "date-taken" | "manual";
    /**
     * Group same-person photos (by filename) into stacks — ONE setting for the
     * editor and the guest gallery. There used to be a second, editor-only
     * `showStacks` defaulting ON while this defaulted OFF, so the admin showed
     * stacks the gallery never had. Unset means "decide from the filenames"
     * (see detectStackable): headshot days stack, weddings and photo booth
     * dumps don't.
     */
    smartStacks?: boolean;
  };
  sharing: SharingSettings;
}

export const DEFAULT_SHARING_SETTINGS: SharingSettings = {
  allowDownload: true,
  allowFavorites: true,
  favoriteMilestones: true,
  guestSearch: true,
  selfieSearch: false,
  password: "",
  expiresAt: "",
  customMessage: "",
  requirePinBulk: false,
  requirePinIndividual: false,
  downloadPin: "",
};

export const DEFAULT_MOSAIC_SETTINGS: MosaicCoverSettings = {
  rows: 3,
  seed: 1,
  logoMode: "none",
  overlay: { color: "#1C1917", opacity: 0.75, blur: false },
  insert: { padding: 15, fill: "#FFFFFF" },
};

export const DEFAULT_SOLID_SETTINGS: SolidCoverSettings = {
  padding: 25,
  colors: ["#1C1917"],
  angle: 135,
};

export const DEFAULT_CROSSFADE_SETTINGS: CrossfadeCoverSettings = {
  count: 5,
  intervalMs: 6000,
};

const clamp01 = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;

/**
 * Colors flow into inline CSS, rgba() decomposition, AND raster SVG markup —
 * only strict #RRGGBB passes; everything else takes the fallback so the live
 * cover and the composed raster can never disagree on a malformed value.
 */
const hexOr = (v: unknown, fallback: string): string =>
  typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : fallback;

/**
 * Single parse point for cover settings coming out of the events.settings
 * JSONB. Fills defaults, coerces legacy rows (no `type`) to "image", and
 * clamps user-controlled numbers. Every reader (gallery API, preview API,
 * OG image, email cover, raster job) must go through this — never poke at
 * the raw JSON shape.
 */
export function normalizeCoverSettings(raw: unknown): CoverSettings {
  const c = (raw ?? {}) as Record<string, unknown>;
  const type: CoverType = ["image", "mosaic", "solid", "crossfade"].includes(
    c.type as string
  )
    ? (c.type as CoverType)
    : "image";

  const rawMosaic = (c.mosaic ?? {}) as Record<string, unknown>;
  const rawOverlay = (rawMosaic.overlay ?? {}) as Record<string, unknown>;
  const rawInsert = (rawMosaic.insert ?? {}) as Record<string, unknown>;
  const rawSolid = (c.solid ?? {}) as Record<string, unknown>;
  const rawFade = (c.crossfade ?? {}) as Record<string, unknown>;
  const rawFocal = c.focalPoint as Record<string, unknown> | undefined;

  return {
    enabled: c.enabled === true,
    type,
    imageId: typeof c.imageId === "string" ? c.imageId : undefined,
    focalPoint: rawFocal
      ? { x: clamp01(rawFocal.x, 0.5), y: clamp01(rawFocal.y, 0.5) }
      : undefined,
    mosaic: {
      sectionId:
        typeof rawMosaic.sectionId === "string" ? rawMosaic.sectionId : undefined,
      rows: [2, 3, 4].includes(rawMosaic.rows as number)
        ? (rawMosaic.rows as 2 | 3 | 4)
        : DEFAULT_MOSAIC_SETTINGS.rows,
      seed:
        typeof rawMosaic.seed === "number" && Number.isFinite(rawMosaic.seed)
          ? rawMosaic.seed
          : DEFAULT_MOSAIC_SETTINGS.seed,
      logoMode: ["none", "overlay", "insert"].includes(rawMosaic.logoMode as string)
        ? (rawMosaic.logoMode as MosaicLogoMode)
        : DEFAULT_MOSAIC_SETTINGS.logoMode,
      logoKey: typeof rawMosaic.logoKey === "string" ? rawMosaic.logoKey : undefined,
      overlay: {
        color: hexOr(rawOverlay.color, DEFAULT_MOSAIC_SETTINGS.overlay.color),
        opacity: clamp01(rawOverlay.opacity, DEFAULT_MOSAIC_SETTINGS.overlay.opacity),
        blur: rawOverlay.blur === true,
      },
      insert: {
        padding:
          typeof rawInsert.padding === "number" && Number.isFinite(rawInsert.padding)
            ? Math.min(45, Math.max(0, rawInsert.padding))
            : DEFAULT_MOSAIC_SETTINGS.insert.padding,
        fill: hexOr(rawInsert.fill, DEFAULT_MOSAIC_SETTINGS.insert.fill),
      },
    },
    solid: {
      logoKey: typeof rawSolid.logoKey === "string" ? rawSolid.logoKey : undefined,
      padding:
        typeof rawSolid.padding === "number" && Number.isFinite(rawSolid.padding)
          ? Math.min(45, Math.max(0, rawSolid.padding))
          : DEFAULT_SOLID_SETTINGS.padding,
      colors: (() => {
        const valid = Array.isArray(rawSolid.colors)
          ? rawSolid.colors
              .filter((x) => typeof x === "string" && /^#[0-9a-fA-F]{6}$/.test(x.trim()))
              .map((x) => (x as string).trim())
              .slice(0, 5)
          : [];
        return valid.length > 0 ? valid : DEFAULT_SOLID_SETTINGS.colors;
      })(),
      angle:
        typeof rawSolid.angle === "number" && Number.isFinite(rawSolid.angle)
          ? ((rawSolid.angle % 360) + 360) % 360
          : DEFAULT_SOLID_SETTINGS.angle,
    },
    crossfade: {
      sectionId:
        typeof rawFade.sectionId === "string" ? rawFade.sectionId : undefined,
      count:
        typeof rawFade.count === "number" && Number.isFinite(rawFade.count)
          ? Math.min(10, Math.max(2, Math.round(rawFade.count)))
          : DEFAULT_CROSSFADE_SETTINGS.count,
      intervalMs:
        typeof rawFade.intervalMs === "number" && Number.isFinite(rawFade.intervalMs)
          ? Math.min(30000, Math.max(3000, rawFade.intervalMs))
          : DEFAULT_CROSSFADE_SETTINGS.intervalMs,
    },
    titlePosition: (["above", "over", "below"] as const).includes(
      c.titlePosition as TitlePosition
    )
      ? (c.titlePosition as TitlePosition)
      : "over",
    titleAlignment: (["left", "center", "right"] as const).includes(
      c.titleAlignment as TitleAlignment
    )
      ? (c.titleAlignment as TitleAlignment)
      : "center",
    titlePlacement: c.titlePlacement as TitlePlacement | undefined,
    hideTitle: typeof c.hideTitle === "boolean" ? c.hideTitle : undefined,
  };
}

/**
 * The cover logo key is stored in owner-writable JSONB, so every sink that
 * dereferences it (presign for the gallery payload, R2 read in the raster
 * job) MUST pin it to this event's branding folder first — otherwise a
 * PATCHed settings blob becomes an arbitrary-bucket-read primitive (the
 * lessons #2/#14 IDOR class, arriving via JSONB instead of a query param).
 */
export function pinnedCoverLogoKey(
  eventId: string,
  key: string | undefined
): string | undefined {
  return key && key.startsWith(`events/${eventId}/branding/cover-logo.`)
    ? key
    : undefined;
}

/**
 * Cover settings with logo keys pinned to the event. The raster composer and
 * the serve-time staleness hash must BOTH run on this (not the raw
 * normalized settings) — if only one side sanitized, a bogus stored key
 * would make the hashes disagree forever and loop regeneration.
 */
export function sanitizeCoverForEvent(
  eventId: string,
  cover: CoverSettings
): CoverSettings {
  return {
    ...cover,
    mosaic: cover.mosaic
      ? { ...cover.mosaic, logoKey: pinnedCoverLogoKey(eventId, cover.mosaic.logoKey) }
      : undefined,
    solid: cover.solid
      ? { ...cover.solid, logoKey: pinnedCoverLogoKey(eventId, cover.solid.logoKey) }
      : undefined,
  };
}

/**
 * Does this cover type need a composed raster (email/OG serving)?
 * Pure predicate — lives here (not raster.ts) so request routes can ask
 * without pulling sharp into their bundle.
 */
export function coverNeedsRaster(cover: CoverSettings): boolean {
  return cover.enabled && (cover.type === "mosaic" || cover.type === "solid");
}

/**
 * The effective "should the event title render on this cover" answer.
 * Explicit hideTitle wins; otherwise auto-hide when a client logo is shown.
 */
export function coverShowsTitle(cover: CoverSettings): boolean {
  if (typeof cover.hideTitle === "boolean") return !cover.hideTitle;
  if (cover.type === "mosaic")
    return cover.mosaic?.logoMode === "none" || !cover.mosaic?.logoKey;
  if (cover.type === "solid") return !cover.solid?.logoKey;
  return true;
}

export const DEFAULT_EVENT_SETTINGS: EventSettings = {
  cover: { enabled: false, type: "image", titlePosition: "over", titleAlignment: "center" },
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
