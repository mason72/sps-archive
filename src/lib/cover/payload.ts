import type { CoverSettings } from "@/types/event-settings";
import { pinnedCoverLogoKey } from "@/types/event-settings";
import type { GallerySettings } from "@/types/gallery";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import { coverGalleryFieldsSync } from "./gallery-fields";

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

  // The mapping itself is pure and shared with the live preview.
  return coverGalleryFieldsSync(cover, logoUrl);
}
