/**
 * Shared media-type rules for the upload pipeline.
 *
 * Used by BOTH the client dropzone (UploadZone) and the server presign route
 * (/api/upload), so the accepted formats and size caps can never drift apart.
 *
 * Container/extension rules live here; codec validation (H.264 video,
 * AAC-or-silent audio) needs ffprobe and happens post-upload in the Modal
 * video pipeline, which fails the row with a clear processing_error message.
 */

/**
 * Image formats the pipeline accepts, as a react-dropzone accept map.
 *
 * HEIC/HEIF is deliberately NOT here: sharp can't decode HEVC-compressed HEIC
 * on Vercel (or macOS prebuilds), so a HEIC upload could never get a thumbnail
 * AND browsers can't render the original — the photo would be invisible
 * everywhere. iPhone consumers hit this; pros shoot JPEG/RAW. We reject it up
 * front with a convert-to-JPEG message (validateUploadFile) rather than
 * shipping a heavy client-side transcoder for an edge case.
 */
export const IMAGE_ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tiff", ".tif"],
  "image/webp": [".webp"],
};

/** Video containers the pipeline accepts (H.264/AAC inside, verified later). */
export const VIDEO_ACCEPT: Record<string, string[]> = {
  "video/mp4": [".mp4"],
  "video/quicktime": [".mov"],
};

export const UPLOAD_ACCEPT: Record<string, string[]> = {
  ...IMAGE_ACCEPT,
  ...VIDEO_ACCEPT,
};

export const IMAGE_MAX_BYTES = 100 * 1024 * 1024; // 100 MB
/** Multi-minute showcase reels are welcome — they route to Cloudflare Stream. */
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024; // 500 MB

export function isVideoMime(mime: string | null | undefined): boolean {
  return !!mime && mime.startsWith("video/");
}

export function mediaTypeForMime(mime: string): "image" | "video" {
  return isVideoMime(mime) ? "video" : "image";
}

/**
 * Validate an upload candidate by mime + size. Returns a user-facing error
 * message, or null when the file is acceptable.
 */
export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (isVideoMime(file.type)) {
    if (!(file.type in VIDEO_ACCEPT)) {
      return `${file.name}: only MP4 and QuickTime (H.264) video is supported`;
    }
    if (file.size > VIDEO_MAX_BYTES) {
      return `${file.name}: videos can be up to 500 MB`;
    }
    return null;
  }
  // HEIC/HEIF gets a specific, actionable message instead of a generic
  // "unsupported" — browsers often report an empty MIME for .heic, so match on
  // the extension too. (See IMAGE_ACCEPT for why we don't accept it.)
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    return `${file.name}: HEIC isn't supported — convert to JPEG first (on a Mac, open in Preview → File → Export → JPEG).`;
  }
  if (!(file.type in IMAGE_ACCEPT)) {
    return `${file.name}: unsupported format`;
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return `${file.name}: images can be up to 100 MB`;
  }
  return null;
}

/** 73.4 → "1:13"; 3601 → "60:01". Used by the grid's duration badge. */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/** Trailing extension for the formats we accept (case-insensitive). */
const MEDIA_EXT_RE = /\.(jpe?g|png|tiff?|webp|heic|heif|mp4|mov)$/i;

/** Lowercase extension of a filename (no dot), or null if none recognized. */
export function mediaExtension(name: string): string | null {
  const m = name.match(MEDIA_EXT_RE);
  return m ? m[1].toLowerCase() : null;
}

/** Drop a recognized trailing extension — the editable base of a filename. */
export function stripMediaExtension(name: string): string {
  return name.replace(MEDIA_EXT_RE, "");
}
