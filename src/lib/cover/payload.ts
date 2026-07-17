import type { CoverSettings } from "@/types/event-settings";
import { coverShowsTitle, pinnedCoverLogoKey } from "@/types/event-settings";
import type { GallerySettings } from "@/types/gallery";
import { getPresignedDownloadUrl } from "@/lib/r2/client";

/**
 * Cover-related GallerySettings fields from normalized cover settings —
 * shared by the public gallery API and the editor preview API so the two
 * payloads can never drift. Presigns the client logo (mosaic/solid) here;
 * internal R2 keys never reach the client, and the settings-supplied key is
 * prefix-pinned to the event before it touches the presigner.
 */
export async function coverGalleryFields(
  cover: CoverSettings,
  eventId: string
): Promise<Partial<GallerySettings>> {
  const logoKey = pinnedCoverLogoKey(
    eventId,
    cover.type === "mosaic" && cover.mosaic?.logoMode !== "none"
      ? cover.mosaic?.logoKey
      : cover.type === "solid"
        ? cover.solid?.logoKey
        : undefined
  );
  const logoUrl = logoKey
    ? await getPresignedDownloadUrl(logoKey, 14400)
    : undefined;

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
