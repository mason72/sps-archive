/**
 * Fetch a postcard's JPEG from Scout's signed URL, with every limit enforced
 * while reading rather than after:
 *  - the URL must pass `checkImageUrl` (https, Scout's storage host only);
 *  - redirects are refused, so an allowed URL cannot bounce somewhere else;
 *  - one deadline covers connect AND body, so a dead socket cannot hold the
 *    function until Vercel kills it (lesson 131);
 *  - the body is counted as it streams and abandoned past the cap, so a huge
 *    or lying Content-Length cannot fill memory;
 *  - the bytes must open like a JPEG (FF D8 FF). The row's mime follows the
 *    BYTES, never a header or a name (the SPS-pull rule).
 */
import { checkImageUrl } from "./validate";

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
  {
    fetchImpl = fetch,
    maxBytes = POSTCARD_MAX_BYTES,
    timeoutMs = POSTCARD_FETCH_TIMEOUT_MS,
  }: { fetchImpl?: typeof fetch; maxBytes?: number; timeoutMs?: number } = {}
): Promise<Buffer> {
  const checked = checkImageUrl(rawUrl);
  if (!checked.ok) throw new PostcardFetchError(checked.error, 400);

  const signal = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(checked.value.toString(), { redirect: "error", signal });
  } catch (err) {
    throw new PostcardFetchError(`Could not fetch image_url: ${errorText(err)}`, 502);
  }
  if (!res.ok) {
    // A signed URL that expired answers 400 from Supabase Storage; either way
    // the fix is on Scout's side (a fresh URL), and the status says so.
    throw new PostcardFetchError(`image_url answered HTTP ${res.status}`, 502);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new PostcardFetchError(`Image is ${declared} bytes; the limit is ${maxBytes}.`, 413);
  }
  if (!res.body) throw new PostcardFetchError("image_url returned no body.", 502);

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
        throw new PostcardFetchError(`Image is over the ${maxBytes}-byte limit.`, 413);
      }
      parts.push(value);
    }
  } catch (err) {
    if (err instanceof PostcardFetchError) throw err;
    throw new PostcardFetchError(`Reading image_url failed: ${errorText(err)}`, 502);
  }

  const buf = Buffer.concat(parts);
  if (buf.byteLength === 0) throw new PostcardFetchError("image_url returned an empty file.", 502);
  if (!looksLikeJpeg(buf)) throw new PostcardFetchError("image_url did not return a JPEG.", 415);
  return buf;
}

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "name" in err && (err as { name: string }).name === "TimeoutError") {
    return "timed out";
  }
  return err instanceof Error ? err.message : String(err);
}
