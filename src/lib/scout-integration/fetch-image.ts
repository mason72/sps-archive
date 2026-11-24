/**
 * Fetch a postcard's JPEG from Scout's signed URL, with every limit enforced
 * while reading rather than after:
 *  - the URL must pass `checkImageUrl` (https, Scout's storage host only);
 *  - redirects are refused, so an allowed URL cannot bounce somewhere else;
 *  - one deadline covers connect AND body, so a dead socket cannot hold the
 *    function until Vercel kills it (lesson 131);
 *  - the body is counted as it streams and abandoned past the cap, so a huge
 *    or lying Content-Length cannot fill memory;
 *  - the bytes must be what they claim: a JPEG (FF D8 FF) for a photo, an
 *    MP4 with a video track for a clip. The row's mime follows the BYTES,
 *    never a header or a name (the SPS-pull rule).
 */
import { checkImageUrl } from "./validate";
import { isMp4Container, mp4TrackKinds } from "@/lib/video/mp4-tracks";

export const POSTCARD_MAX_BYTES = 40 * 1024 * 1024;
export const POSTCARD_FETCH_TIMEOUT_MS = 30_000;

export class PostcardFetchError extends Error {
  constructor(
    message: string,
    /** 400: the request was wrong. 413/415: the file was. 502: Scout's storage failed us. */
    readonly status: 400 | 413 | 415 | 502
  ) {
    super(message);
    this.name = "PostcardFetchError";
  }
}

export function looksLikeJpeg(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export async function fetchPostcardImage(
  rawUrl: string,
  opts: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}
): Promise<Buffer> {
  const checked = checkImageUrl(rawUrl);
  if (!checked.ok) throw new PostcardFetchError(checked.error, 400);
  const buf = await fetchCapped(
    checked.value,
    { ...opts, maxBytes: opts.maxBytes ?? POSTCARD_MAX_BYTES },
    "image_url"
  );
  if (!looksLikeJpeg(buf)) throw new PostcardFetchError("image_url did not return a JPEG.", 415);
  return buf;
}

/** Scout's own cap on a clip (its storage bucket's file limit). */
export const POSTCARD_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
/** A 50 MB clip at a slow link still fits; the deadline covers connect and body. */
export const POSTCARD_VIDEO_TIMEOUT_MS = 60_000;

/**
 * A clip from Scout's storage: same URL rules and limits style as the image,
 * a 50 MB cap, and the bytes must be an MP4 with a video track. Its audio is
 * NOT judged here; the clip is never stored as fetched (see the store).
 */
export async function fetchPostcardVideo(
  rawUrl: string,
  opts: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}
): Promise<Buffer> {
  const checked = checkImageUrl(rawUrl, "video_url");
  if (!checked.ok) throw new PostcardFetchError(checked.error, 400);
  const buf = await fetchCapped(
    checked.value,
    {
      ...opts,
      maxBytes: opts.maxBytes ?? POSTCARD_VIDEO_MAX_BYTES,
      timeoutMs: opts.timeoutMs ?? POSTCARD_VIDEO_TIMEOUT_MS,
    },
    "video_url"
  );
  if (!isMp4Container(buf)) throw new PostcardFetchError("video_url did not return an MP4.", 415);
  let kinds: string[];
  try {
    kinds = mp4TrackKinds(buf);
  } catch (err) {
    throw new PostcardFetchError(`video_url is not a readable MP4: ${errorText(err)}`, 415);
  }
  if (!kinds.includes("vide")) throw new PostcardFetchError("video_url has no video track.", 415);
  return buf;
}

/**
 * The shared reader: no redirects, one deadline over connect and body, and a
 * byte count enforced while streaming. `url` must already be vetted.
 */
export async function fetchCapped(
  url: URL,
  {
    fetchImpl = fetch,
    maxBytes,
    timeoutMs = POSTCARD_FETCH_TIMEOUT_MS,
  }: { fetchImpl?: typeof fetch; maxBytes: number; timeoutMs?: number },
  label: string
): Promise<Buffer> {
  // An undefined cap (e.g. `{ maxBytes: undefined }` spread over a default)
  // would compare false forever and read without limit; refuse instead.
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error(`fetchCapped: no byte cap for ${label}`);
  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(url.toString(), { redirect: "error", signal });
  } catch (err) {
    throw new PostcardFetchError(`Could not fetch ${label}: ${errorText(err)}`, 502);
  }
  if (!res.ok) {
    // A signed URL that expired answers 400 from Supabase Storage; either way
    // the fix is on Scout's side (a fresh URL), and the status says so.
    throw new PostcardFetchError(`${label} answered HTTP ${res.status}`, 502);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PostcardFetchError(`${label} is ${declared} bytes; the limit is ${maxBytes}.`, 413);
  }
  if (!res.body) throw new PostcardFetchError(`${label} returned no body.`, 502);

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new PostcardFetchError(`${label} is over the ${maxBytes}-byte limit.`, 413);
      }
      parts.push(value);
    }
  } catch (err) {
    if (err instanceof PostcardFetchError) throw err;
    throw new PostcardFetchError(`Reading ${label} failed: ${errorText(err)}`, 502);
  }

  const buf = Buffer.concat(parts);
  if (buf.byteLength === 0) throw new PostcardFetchError(`${label} returned an empty file.`, 502);
  return buf;
}

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "TimeoutError") {
    return "timed out";
  }
  return err instanceof Error ? err.message : String(err);
}
