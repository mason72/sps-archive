/**
 * Parse structured information from image filenames.
 *
 * Handles common photographer naming conventions:
 *   "SmithJohn_001.jpg"       → { name: "Smith, John", sequence: 1 }
 *   "Smith_John_001.jpg"      → { name: "Smith, John", sequence: 1 }
 *   "John Smith-001.jpg"      → { name: "John Smith", sequence: 1 }
 *   "JohnSmith_headshot_3.jpg"→ { name: "John Smith", sequence: 3 }
 *   "IMG_4532.jpg"            → { name: null, sequence: 4532 }
 *   "DSC_0012.RAW"            → { name: null, sequence: 12 }
 */

export interface ParsedFilename {
  /** Extracted person name, or null if not detected */
  name: string | null;
  /** Sequence/frame number if found */
  sequence: number | null;
  /** Original filename without extension */
  stem: string;
  /** File extension (lowercase, no dot) */
  extension: string;
}

/** Camera-generated prefixes that indicate no name is embedded */
const CAMERA_PREFIXES = /^(IMG|DSC|DSCF|DSCN|P|_MG|_DSC|SAM|GOPR|DJI|R0|DCIM)/i;

/** Common separators used in filenames */
const SEPARATORS = /[_\- ]+/;

export function parseFilename(filename: string): ParsedFilename {
  const lastDot = filename.lastIndexOf(".");
  const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const extension = lastDot > 0 ? filename.slice(lastDot + 1).toLowerCase() : "";

  // Camera-generated filenames — no name, just extract sequence
  if (CAMERA_PREFIXES.test(stem)) {
    const seqMatch = stem.match(/(\d+)\s*$/);
    return {
      name: null,
      sequence: seqMatch ? parseInt(seqMatch[1], 10) : null,
      stem,
      extension,
    };
  }

  // Try to extract name and sequence
  const parts = stem.split(SEPARATORS).filter(Boolean);

  // Find trailing number (sequence)
  let sequence: number | null = null;
  const nameParts: string[] = [];

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      sequence = parseInt(part, 10);
    } else if (!/^(headshot|portrait|photo|final|edit|raw|web|print)$/i.test(part)) {
      nameParts.push(part);
    }
  }

  if (nameParts.length === 0) {
    return { name: null, sequence, stem, extension };
  }

  // Try to detect CamelCase: "SmithJohn" → "Smith, John"
  if (nameParts.length === 1 && /^[A-Z][a-z]+[A-Z]/.test(nameParts[0])) {
    const camelParts = nameParts[0].match(/[A-Z][a-z]+/g);
    if (camelParts && camelParts.length === 2) {
      return {
        name: `${camelParts[0]}, ${camelParts[1]}`,
        sequence,
        stem,
        extension,
      };
    }
  }

  // Multiple parts: assume "Last_First" or "First_Last"
  const name = nameParts.join(" ");
  return { name: name || null, sequence, stem, extension };
}

/**
 * Extract EXIF data from an image buffer.
 * Uses the exifr library for fast, selective parsing.
 */
export async function extractExif(buffer: ArrayBuffer) {
  const exifr = await import("exifr");

  try {
    const data = await exifr.parse(buffer, {
      pick: [
        "DateTimeOriginal",
        "Make",
        "Model",
        "LensModel",
        "FocalLength",
        "FNumber",
        "ExposureTime",
        "ISO",
        "GPSLatitude",
        "GPSLongitude",
        "ImageWidth",
        "ImageHeight",
        "ExifImageWidth",
        "ExifImageHeight",
      ],
    });

    if (!data) return null;

    return {
      takenAt: data.DateTimeOriginal
        ? new Date(data.DateTimeOriginal).toISOString()
        : null,
      cameraMake: data.Make || null,
      cameraModel: data.Model || null,
      lens: data.LensModel || null,
      focalLength: data.FocalLength || null,
      aperture: data.FNumber || null,
      shutterSpeed: data.ExposureTime
        ? data.ExposureTime < 1
          ? `1/${Math.round(1 / data.ExposureTime)}`
          : `${data.ExposureTime}`
        : null,
      iso: data.ISO || null,
      gpsLat: data.GPSLatitude || null,
      gpsLng: data.GPSLongitude || null,
      width: data.ExifImageWidth || data.ImageWidth || null,
      height: data.ExifImageHeight || data.ImageHeight || null,
    };
  } catch {
    return null;
  }
}
