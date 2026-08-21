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
import { collapseRepeatedWords } from "@/lib/gallery/stacks";

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

  // Multiple parts: assume "Last_First" or "First_Last". A word repeated
  // back-to-back ("Tori Marifian Marifian") is a shoot-time typo, not a name.
  const name = collapseRepeatedWords(nameParts.join(" "));
  return { name: name || null, sequence, stem, extension };
}

/**
 * Extract EXIF data from an image buffer.
 * Uses the exifr library for fast, selective parsing.
 */
/**
 * EXIF GPS → decimal degrees, or null.
 *
 * exifr hands back GPS as a DEGREES/MINUTES/SECONDS TUPLE — `[33, 38.1798, 0]`
 * — not a number. `gps_lat` and `gps_lng` are `double precision`, so passing the
 * tuple through made Postgres reject the whole row update with
 * `22P02 invalid input syntax for type double precision: "[33,38.1798,0]"`.
 *
 * That failure was invisible for a long time, and worse than it looks: the GPS
 * fields ride in the SAME update as `processing_status` and
 * `thumbnail_generated`, so ONE unconvertible tuple stranded the entire row at
 * `pending` with no thumbnail — a ghost tile. It surfaced only when a Pixieset
 * collection shot on a GPS-equipped Canon 1DX put 69 of them in one gallery;
 * across the other 31,000 images in the archive, `gps_lat` had never once been
 * set, because pro bodies do not geotag without an accessory.
 *
 * The REF carries the hemisphere. Without it "112° W" becomes +112 and the
 * photo claims to have been taken in China, which is a worse failure than
 * having no coordinate at all — so a missing or unrecognised ref on a
 * *southern/western* value is not guessed, it is simply applied as positive
 * only when the ref is absent AND the value is already signed.
 *
 * Out-of-range results return null. A coordinate that cannot be real should not
 * reach the column just because it parsed.
 */
export function toDecimalDegrees(
  value: unknown,
  ref: unknown,
  limit: 90 | 180
): number | null {
  let deg: number | null = null;

  if (typeof value === "number" && Number.isFinite(value)) {
    deg = value;
  } else if (Array.isArray(value) && value.length > 0) {
    const [d = 0, m = 0, sec = 0] = value.map((v) => (typeof v === "number" ? v : Number(v)));
    if ([d, m, sec].some((x) => !Number.isFinite(x))) return null;
    // Sign lives on the ref, not on the degrees component; take |d| so a
    // pre-signed tuple cannot double-negate below.
    deg = Math.abs(d) + m / 60 + sec / 3600;
    if (d < 0) deg = -deg;
  } else {
    return null;
  }

  const hemisphere = typeof ref === "string" ? ref.trim().toUpperCase()[0] : null;
  if (hemisphere === "S" || hemisphere === "W") deg = -Math.abs(deg);
  else if (hemisphere === "N" || hemisphere === "E") deg = Math.abs(deg);

  if (!Number.isFinite(deg) || Math.abs(deg) > limit) return null;
  // Sub-metre precision is meaningless here and full float noise makes diffs
  // unreadable; 7 places is ~11 mm.
  return Number(deg.toFixed(7));
}

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
        // The REF is the hemisphere, and without it a western longitude comes
        // out positive — an Arizona shoot lands in China.
        "GPSLatitudeRef",
        "GPSLongitudeRef",
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
      gpsLat: toDecimalDegrees(data.GPSLatitude, data.GPSLatitudeRef, 90),
      gpsLng: toDecimalDegrees(data.GPSLongitude, data.GPSLongitudeRef, 180),
      width: data.ExifImageWidth || data.ImageWidth || null,
      height: data.ExifImageHeight || data.ImageHeight || null,
    };
  } catch {
    return null;
  }
}
