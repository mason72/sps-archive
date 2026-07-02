import type { Archiver } from "archiver";
import { getPresignedDownloadUrl } from "@/lib/r2/client";
import { safeFolder, type DownloadImage } from "@/lib/gallery/download-core";

/**
 * The ZIP producer loop, shared by the synchronous download route and the
 * background builder: fetch originals from R2 with a prefetch window, append
 * to the archive in order, respect the consumer via a high-water gate.
 */

/**
 * How many R2 fetches to keep in flight ahead of the append cursor.
 * Sequential fetching cost ~0.4s of latency PER FILE (that alone blew the
 * 300s platform timeout at 1500+ files); a window of 8 hides the latency
 * while keeping at most ~8 image buffers in memory.
 */
const PREFETCH_WINDOW = 8;

/** Pause appending when archiver has this much buffered for a slow consumer. */
const BUFFER_HIGH_WATER = 64 * 1024 * 1024;

/** Fetch an image's bytes with a couple retries for transient R2/network blips. */
async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok && response.body) {
        return Buffer.from(await response.arrayBuffer());
      }
    } catch {
      // fall through to retry
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
  }
  return null;
}

/**
 * Append every image to the archive (does NOT finalize). Returns the
 * filenames that could not be fetched after retries — the caller decides how
 * to surface them (manifest entry + admin alarm). Bails out silently if the
 * archive is destroyed (consumer went away).
 */
export async function appendImagesToArchive(
  archive: Archiver,
  images: DownloadImage[],
  sectionsByImage: Map<string, string[]>
): Promise<string[]> {
  const failed: string[] = [];
  const pending = new Map<number, Promise<Buffer | null>>();
  const fetchOne = async (img: DownloadImage) => {
    try {
      const url = await getPresignedDownloadUrl(img.r2_key, 3600);
      return url ? await fetchImageBuffer(url) : null;
    } catch {
      return null;
    }
  };

  for (let i = 0; i < images.length; i++) {
    for (let j = i; j < Math.min(i + PREFETCH_WINDOW, images.length); j++) {
      if (!pending.has(j)) pending.set(j, fetchOne(images[j]));
    }
    const buffer = await pending.get(i)!;
    pending.delete(i);
    const img = images[i];
    if (!buffer) {
      failed.push(img.original_filename);
      continue;
    }

    // If the consumer drains slower than R2 feeds us, archiver's internal
    // buffer grows without bound — hold appends until it drains. A destroyed
    // archive means the consumer went away: stop fetching.
    while (archive.readableLength > BUFFER_HIGH_WATER && !archive.destroyed) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (archive.destroyed) return failed;

    // Place the file in a folder per section it belongs to (in each, if
    // multiple); root if it belongs to none.
    const folders = sectionsByImage.get(img.id);
    if (folders && folders.length > 0) {
      for (const folder of folders) {
        archive.append(buffer, {
          name: `${safeFolder(folder)}/${img.original_filename}`,
        });
      }
    } else {
      archive.append(buffer, { name: img.original_filename });
    }
  }

  return failed;
}

/** The manifest entry appended when some photos couldn't be fetched. */
export function missingFilesManifest(failed: string[], total: number): string {
  return (
    `These ${failed.length} of ${total} photos couldn't be included ` +
    `and may need to be re-downloaded individually:\n\n${failed.join("\n")}\n`
  );
}
