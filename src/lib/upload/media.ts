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

/** Image formats the pipeline accepts, as a react-dropzone accept map. */
export const IMAGE_ACCEPT: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/tiff": [".tiff", ".tif"],
  "image/webp": [".webp"],
  "image/heic": [".heic", ".heif"],
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
