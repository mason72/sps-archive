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
 * The extension a file SHOULD carry, given the bytes' mime and the extension
 * its name already has. Returns the name's extension when it fits the mime
 * (`.jpeg` stays `.jpeg`), the mime's canonical one when it does not
 * (`(AI) Justin.jpg` served as image/webp → `webp`), and the name's own
 * when the mime is unknown — a guess would be worse than the name.
 *
 * Exists because SPS names AI renders after their source JPEG and stores
 * them as WebP; a `.jpg` full of WebP bytes opens nowhere.
 */
export function extensionForMime(mime: string | null | undefined, ext: string): string {
  const key = (mime ?? "").toLowerCase().split(";")[0].trim();
  const accepted = UPLOAD_ACCEPT[key];
  if (!accepted) return ext;
  const dotted = `.${ext.toLowerCase()}`;
  if (accepted.includes(dotted)) return ext;
  return accepted[0].slice(1);
}

/**
 * Camera raw, by extension. Browsers report no MIME for most of these, so the
 * generic branch would call a .CR3 "unsupported format" — technically true and
 * useless to a photographer, who wants to know it is the RAW that is the
 * problem and not the photo. Named formats get named answers.
 */
const RAW_EXT_RE = /\.(cr2|cr3|nef|nrw|arw|srf|sr2|orf|raf|rw2|pef|dng|3fr|iiq)$/i;

/** Editable/layered documents that land in a photo folder by accident. */
const DOC_EXT_RE = /\.(psd|psb|ai|indd|xcf|eps)$/i;

/**
 * Why this file cannot be uploaded, as a bare phrase with NO filename in it —
 * "camera raw (CR3) isn't supported", not "IMG_0042.CR3: ...".
 *
 * Split out from `validateUploadFile` on 2026-08-16. The upload list already
 * prints the filename in its own column, so a name-prefixed message rendered
 * there is both redundant and destructive: the row truncates at ~180px, so a
 * long name ate the entire message and Mason's two rejected files showed
 * "Daren Matsuoka_25-06-05_a16z..." as their reason. The reason was there; the
 * filename had pushed it off the end.
 */
export function uploadRejectionReason(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  if (isVideoMime(file.type)) {
    if (!(file.type in VIDEO_ACCEPT)) {
      return "only MP4 and QuickTime (H.264) video is supported";
    }
    if (file.size > VIDEO_MAX_BYTES) {
      return "videos can be up to 500 MB";
    }
    return null;
  }
  // HEIC/HEIF gets a specific, actionable message instead of a generic
  // "unsupported" — browsers often report an empty MIME for .heic, so match on
  // the extension too. (See IMAGE_ACCEPT for why we don't accept it.)
  if (/\.(heic|heif)$/i.test(file.name) || /heic|heif/i.test(file.type)) {
    return "HEIC isn't supported — convert to JPEG first (on a Mac, open in Preview → File → Export → JPEG)";
  }
  const raw = file.name.match(RAW_EXT_RE);
  if (raw) {
    return `camera raw (${raw[1].toUpperCase()}) isn't supported — export a JPEG`;
  }
  const doc = file.name.match(DOC_EXT_RE);
  if (doc) {
    return `${doc[1].toUpperCase()} isn't supported — flatten and export a JPEG`;
  }
  if (!(file.type in IMAGE_ACCEPT)) {
    const ext = file.name.match(/\.([a-z0-9]{1,5})$/i);
    return ext
      ? `${ext[1].toUpperCase()} isn't a supported format`
      : "unsupported format";
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return "images can be up to 100 MB";
  }
  return null;
}

/**
 * Validate an upload candidate by mime + size. Returns a user-facing error
 * message PREFIXED WITH THE FILENAME, or null when the file is acceptable.
 *
 * Keep this shape: the presign route reports on a whole batch at once, where
 * the name is the only thing identifying which file the message is about. Use
 * `uploadRejectionReason` wherever the name is already on screen.
 */
export function validateUploadFile(file: {
  name: string;
  type: string;
  size: number;
}): string | null {
  const reason = uploadRejectionReason(file);
  return reason ? `${file.name}: ${reason}` : null;
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
