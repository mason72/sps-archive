"use client";

/**
 * Browser-side preparation of a BTS photo: read what the camera wrote, then
 * make the two renditions the store keeps.
 *
 * Two renditions, both made HERE and not on a server: a 2048px long-edge
 * JPEG (the one you look at) and a 480px thumb (the strip). These are
 * reference shots of a loading dock, not deliverables — a 12MP phone original
 * over hotel wifi is the slow path nobody needs, and no route has to touch
 * sharp for it.
 *
 * EXIF is read BEFORE the redraw, because a canvas keeps none of it: the
 * taken-at time and GPS are what let the composer propose the gig and the
 * venue, and orientation is what keeps a portrait shot upright.
 */

export interface PreparedImage {
  /** 2048px long edge, JPEG. */
  full: Blob;
  /** 480px long edge, JPEG. */
  thumb: Blob;
  width: number;
  height: number;
  /** ISO string when the camera wrote one. */
  takenAt: string | null;
  gps: { lat: number; lng: number } | null;
  /** A local object URL for previewing; caller revokes it. */
  previewUrl: string;
}

export const FULL_EDGE = 2048;
export const THUMB_EDGE = 480;

export async function prepareImage(file: File): Promise<PreparedImage> {
  const [exif, bitmap] = await Promise.all([readExif(file), decode(file)]);
  const full = await render(bitmap, FULL_EDGE);
  const thumb = await render(bitmap, THUMB_EDGE);
  bitmap.close?.();
  return {
    full: full.blob,
    thumb: thumb.blob,
    width: full.width,
    height: full.height,
    takenAt: exif.takenAt,
    gps: exif.gps,
    previewUrl: URL.createObjectURL(thumb.blob),
  };
}

async function readExif(file: File): Promise<{ takenAt: string | null; gps: { lat: number; lng: number } | null }> {
  try {
    const exifr = await import("exifr");
    const data = (await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef"],
      // `gps: true` reads the GPS block; exifr then derives decimal
      // `latitude`/`longitude` from the DMS tuples (which is what we read).
      gps: true,
    })) as Record<string, unknown> | undefined;
    const when = (data?.DateTimeOriginal ?? data?.CreateDate) as Date | string | undefined;
    let takenAt: string | null = null;
    if (when instanceof Date && Number.isFinite(when.getTime())) takenAt = when.toISOString();
    else if (typeof when === "string" && Number.isFinite(Date.parse(when))) takenAt = new Date(when).toISOString();

    let gps: { lat: number; lng: number } | null = null;
    const lat = data?.latitude as number | undefined;
    const lng = data?.longitude as number | undefined;
    if (typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
      gps = { lat, lng };
    }
    return { takenAt, gps };
  } catch {
    return { takenAt: null, gps: null };
  }
}

async function decode(file: File): Promise<ImageBitmap> {
  // `from-image` applies the EXIF orientation so the canvas draw is upright.
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

async function render(bitmap: ImageBitmap, edge: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob) throw new Error("Could not encode");
  return { blob, width, height };
}

/** Straight-line metres between two points — for "nearest known venue". */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** PUT a blob to a presigned URL. Resolves only on a 2xx. */
export async function putBlob(url: string, blob: Blob): Promise<void> {
  const res = await fetch(url, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } });
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
}
