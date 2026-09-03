import type { CoverSettings, EventSettings } from "@/types/event-settings";
import { coverShowsTitle, normalizeCoverSettings } from "@/types/event-settings";
import type { GallerySettings } from "@/types/gallery";

/**
 * The PURE half of turning event settings into what the gallery renders.
 *
 * Split out of `payload.ts` (2026-09-02) so the editor's live preview can
 * apply a settings change without a round trip. Every tweak on the Design
 * panel used to reload the whole preview iframe — the event, the profile,
 * every image row with three signed URLs, every section link, then a full
 * grid render — before the mosaic redrew: "it takes seconds to reload after
 * every tiny adjustment" (Mason, on the logo-spacing slider). The mosaic
 * needs none of that; it lays out from the pool the preview already holds.
 *
 * Signed URLs (`logoUrl`, `coverImageUrl`) are the one thing only the server
 * can mint, so they are inputs here: the server passes what it presigned,
 * the preview passes what it already has. A NEW logo or cover photo is the
 * case that still reloads — the page decides that by comparing keys.
 */
export function coverGalleryFieldsSync(
  cover: CoverSettings,
  logoUrl: string | undefined
): Partial<GallerySettings> {
  return {
    coverEnabled: cover.enabled,
    coverType: cover.type,
    coverFocalPoint: cover.focalPoint,
    coverMosaic:
      cover.type === "mosaic" && cover.mosaic
        ? {
            sectionId: cover.mosaic.sectionId,
            rows: cover.mosaic.rows,
            seed: cover.mosaic.seed,
            logoMode: cover.mosaic.logoMode,
            logoUrl,
            overlay: cover.mosaic.overlay,
            insert: cover.mosaic.insert,
            logoScale: cover.mosaic.logoScale,
          }
        : undefined,
    coverSolid:
      cover.type === "solid" && cover.solid
        ? {
            logoUrl,
            padding: cover.solid.padding,
            colors: cover.solid.colors,
            angle: cover.solid.angle,
          }
        : undefined,
    coverCrossfade: cover.type === "crossfade" ? cover.crossfade : undefined,
    coverShowsTitle: coverShowsTitle(cover),
    titlePosition: cover.titlePosition,
    titleAlignment: cover.titleAlignment,
    titlePlacement: cover.titlePlacement,
  };
}

/**
 * Apply a fresh EventSettings to a gallery payload the preview already
 * holds. Keeps every server-minted field (signed URLs, the stackability
 * verdict, sort, sharing) and replaces the design fields — cover, fonts,
 * colours, grid — from the new settings. Photo-cover fit/padding ride along
 * only while the server-signed photo URL exists.
 */
export function applyPreviewSettings(
  prev: GallerySettings,
  next: EventSettings
): GallerySettings {
  const cover = normalizeCoverSettings(next.cover);
  const prevLogoUrl = prev.coverMosaic?.logoUrl ?? prev.coverSolid?.logoUrl;
  const out: GallerySettings = {
    ...prev,
    ...coverGalleryFieldsSync(cover, prevLogoUrl),
    headingFont: next.typography?.headingFont ?? prev.headingFont,
    bodyFont: next.typography?.bodyFont ?? prev.bodyFont,
    colorPrimary: next.color?.primary ?? prev.colorPrimary,
    colorSecondary: next.color?.secondary ?? prev.colorSecondary,
    colorAccent: next.color?.accent ?? prev.colorAccent,
    colorBackground: next.color?.background ?? prev.colorBackground,
    gridStyle: (next.grid?.style as GallerySettings["gridStyle"]) ?? prev.gridStyle,
    gridColumns: next.grid?.columns ?? prev.gridColumns,
    gridGap: (next.grid?.gap as GallerySettings["gridGap"]) ?? prev.gridGap,
    smartStacks: next.grid?.smartStacks ?? prev.smartStacks,
  };
  if (prev.coverImageUrl && cover.enabled && cover.imageId) {
    out.coverImageUrl = prev.coverImageUrl;
    out.coverImageFit = cover.image?.fit ?? "cover";
    out.coverImagePadding = cover.image?.padding;
  } else {
    delete out.coverImageUrl;
  }
  return out;
}

/** The message the editor posts into its preview iframe. */
export const PREVIEW_SETTINGS_MESSAGE = "pixeltrunk:preview-settings" as const;

/**
 * Does this settings change need a server round trip? Only a NEW cover photo
 * or logo file does — those are signed URLs the preview cannot mint.
 */
export function previewNeedsReload(prev: EventSettings, next: EventSettings): boolean {
  const a = normalizeCoverSettings(prev.cover);
  const b = normalizeCoverSettings(next.cover);
  return (
    a.imageId !== b.imageId ||
    a.mosaic?.logoKey !== b.mosaic?.logoKey ||
    a.solid?.logoKey !== b.solid?.logoKey
  );
}
