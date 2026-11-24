/**
 * Replace every URL's query string with `?<redacted>`.
 *
 * Signed URLs (Supabase Storage `?token=`, R2/S3 `?X-Amz-Signature=`) are
 * credentials for as long as they live, and error text from ffmpeg, the Modal
 * pipeline or a fetch can quote one. Everything the Scout clip path reports to
 * `system_errors` or the log goes through this first. The path stays, so the
 * message still says WHICH object failed.
 */
const SIGNED_QUERY = /(https?:\/\/[^\s?'"<>]+)\?[^\s'"<>]*/g;

export function scrubSignedUrls(text: string): string {
  return String(text ?? "").replace(SIGNED_QUERY, "$1?<redacted>");
}

/** An Error whose message is scrubbed, keeping the name; the original is not attached. */
export function scrubbedError(err: unknown): Error {
  const raw = err instanceof Error ? err.message : String(err);
  const out = new Error(scrubSignedUrls(raw));
  if (err instanceof Error) out.name = err.name;
  return out;
}
