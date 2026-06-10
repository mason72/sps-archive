import type { createServiceClient } from "@/lib/supabase/server";
import { autoFocalForImages } from "./focal";
import { publishImageToLane, unpublishImageFromLane } from "./publish";
import { scheduleSiteRevalidate } from "./revalidate";
import { deriveServiceFromScene, isSlotScene } from "./scenes";

type SupabaseClient = ReturnType<typeof createServiceClient>;

export interface SyncResult {
  published: string[];
  unpublished: string[];
  /** Image ids whose R2 copy/delete failed — they'll be retried on the next sync. */
  failed: string[];
}

/**
 * Reconcile the public marketing lane (sps-public) with website-section
 * membership for the given images. Membership IS publication:
 *
 *  - in ≥1 website section (sections.site_scene_key set) → public variants
 *    copied to sps-public, site_published_at stamped, images.service
 *    auto-filled from the scene's implied service (never overwriting a manual
 *    value)
 *  - in none, but previously published → public copies deleted,
 *    site_published_at cleared
 *
 * Idempotent and desired-state based, so every membership mutation path can
 * call it after the fact without tracking deltas. Images without thumbnails
 * yet are skipped (nothing to copy); the upload-complete paths re-sync once
 * thumbnails exist. Re-publishing an already-published image just re-copies —
 * cheap, and it heals a stale lane.
 *
 * Failures are per-image and logged; the DB marker is only moved when the R2
 * operation succeeds, so a failed image stays eligible for the next sync.
 */
export async function syncSitePublication(
  supabase: SupabaseClient,
  imageIds: string[]
): Promise<SyncResult> {
  const result: SyncResult = { published: [], unpublished: [], failed: [] };
  if (imageIds.length === 0) return result;

  // Which of these images live in a website section, and under which scenes?
  const { data: links, error: linksError } = await supabase
    .from("section_images")
    .select("image_id, sections!inner(site_scene_key)")
    .in("image_id", imageIds)
    .not("sections.site_scene_key", "is", null);
  if (linksError) throw linksError;

  // The hand-maintained DB types carry no FK metadata, so PostgREST embeds
  // don't infer — shape the rows explicitly.
  const linkRows = (links ?? []) as unknown as Array<{
    image_id: string;
    sections: { site_scene_key: string | null } | null;
  }>;

  const scenesByImage = new Map<string, string[]>();
  for (const link of linkRows) {
    const key = link.sections?.site_scene_key;
    if (!key) continue;
    const arr = scenesByImage.get(link.image_id);
    if (arr) arr.push(key);
    else scenesByImage.set(link.image_id, [key]);
  }

  const { data: images, error: imagesError } = await supabase
    .from("images")
    .select(
      "id, r2_key, service, focal_x, site_published_at, thumbnail_generated"
    )
    .in("id", imageIds);
  if (imagesError) throw imagesError;

  // Slot scenes are art-directed crops — if an image landing in one has no
  // focal point yet, suggest one from its detected faces (single confident
  // subject only). Writes into null exclusively; a manual pick or deliberate
  // clear is never overwritten.
  const focalCandidates = (images ?? [])
    .filter(
      (img) =>
        img.focal_x === null &&
        (scenesByImage.get(img.id) ?? []).some(isSlotScene)
    )
    .map((img) => img.id);
  const autoFocal = await autoFocalForImages(supabase, focalCandidates);

  await Promise.all(
    (images ?? []).map(async (img) => {
      const sceneKeys = scenesByImage.get(img.id);

      if (sceneKeys) {
        // Desired: published. No thumbnails yet → nothing to copy; the
        // upload-complete paths call sync again once they exist.
        if (!img.thumbnail_generated) return;
        try {
          await publishImageToLane(img.r2_key);
          const update: Record<string, unknown> = {
            site_published_at: new Date().toISOString(),
          };
          if (!img.service) {
            const implied = sceneKeys
              .map(deriveServiceFromScene)
              .find((s) => s !== null);
            if (implied) update.service = implied;
          }
          const focal = autoFocal.get(img.id);
          if (focal) {
            update.focal_x = focal.x;
            update.focal_y = focal.y;
          }
          const { error } = await supabase
            .from("images")
            .update(update)
            .eq("id", img.id);
          if (error) throw error;
          result.published.push(img.id);
        } catch (err) {
          console.error("Site publish failed for", img.r2_key, err);
          result.failed.push(img.id);
        }
        return;
      }

      if (img.site_published_at) {
        // Desired: not published. Delete copies first; only clear the marker
        // on success so a failed delete is retried by the next sync.
        try {
          await unpublishImageFromLane(img.r2_key);
          const { error } = await supabase
            .from("images")
            .update({ site_published_at: null })
            .eq("id", img.id);
          if (error) throw error;
          result.unpublished.push(img.id);
        } catch (err) {
          console.error("Site unpublish failed for", img.r2_key, err);
          result.failed.push(img.id);
        }
      }
    })
  );

  // Website content changed — refresh the marketing site's cache. After the
  // R2 work above, so the site never refetches an image that isn't publicly
  // readable yet. (Failed images are retried by a later sync, which pings.)
  if (result.published.length > 0 || result.unpublished.length > 0) {
    scheduleSiteRevalidate();
  }

  return result;
}
