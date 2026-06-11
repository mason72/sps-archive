/**
 * Cloudflare Stream client — the publishing lane for videos the R2 public
 * lane can't serve well: anything LONG (>60s) or SOUND-ON (showcase reels
 * with voiceover). Stream transcodes to adaptive HLS, so a 3-minute reel
 * plays smoothly without us shipping a 400MB mp4 through the CDN.
 *
 * Ingestion uses Stream's copy-from-URL API with a presigned R2 GET — no
 * bytes through the app server, mirroring the bucket-to-bucket copies of the
 * R2 public lane.
 *
 * Env (R2 and Stream live on the same Cloudflare account):
 *   CLOUDFLARE_STREAM_API_TOKEN    — API token with Stream:Edit
 *   CLOUDFLARE_STREAM_CUSTOMER_CODE — the customer-XXXX playback subdomain code
 *   CLOUDFLARE_ACCOUNT_ID          — optional; falls back to R2_ACCOUNT_ID
 */

/** Videos at or under this length with no audio stay on the R2 public lane. */
export const STREAM_MIN_DURATION_SECONDS = 60;

function accountId(): string | undefined {
  return process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID;
}

function apiToken(): string | undefined {
  return process.env.CLOUDFLARE_STREAM_API_TOKEN;
}

function customerCode(): string | undefined {
  return process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE;
}

/** Can we both ingest (token + account) and build playback URLs (code)? */
export function isStreamConfigured(): boolean {
  return !!(apiToken() && accountId() && customerCode());
}

/** Does this video need Stream, or can the R2 public lane serve it? */
export function needsStream(video: {
  durationSeconds: number | null;
  hasAudio: boolean | null;
}): boolean {
  return (
    (video.durationSeconds ?? 0) > STREAM_MIN_DURATION_SECONDS ||
    video.hasAudio === true
  );
}

/** HLS manifest URL — what <video> players (hls.js / Safari) consume. */
export function streamHlsUrl(uid: string): string {
  return `https://customer-${customerCode()}.cloudflarestream.com/${uid}/manifest/video.m3u8`;
}

/** Drop-in iframe player URL, for sites that prefer the hosted player. */
export function streamIframeUrl(uid: string): string {
  return `https://customer-${customerCode()}.cloudflarestream.com/${uid}/iframe`;
}

/**
 * Ingest a video into Stream by URL (presigned R2 GET). Returns the Stream
 * UID. Stream transcodes asynchronously after this returns; playback URLs go
 * live when it finishes (typically well under the site's 5-minute cache).
 */
export async function copyToStream(
  sourceUrl: string,
  name: string
): Promise<string> {
  const account = accountId();
  const token = apiToken();
  if (!account || !token) {
    throw new Error(
      "Cloudflare Stream is not configured (CLOUDFLARE_STREAM_API_TOKEN / account id)"
    );
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/stream/copy`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: sourceUrl, meta: { name } }),
    }
  );

  const json = (await res.json()) as {
    success: boolean;
    result?: { uid?: string };
    errors?: Array<{ message?: string }>;
  };
  const uid = json.result?.uid;
  if (!res.ok || !json.success || !uid) {
    const detail =
      json.errors?.map((e) => e.message).filter(Boolean).join("; ") ||
      `HTTP ${res.status}`;
    throw new Error(`Stream copy failed: ${detail}`);
  }
  return uid;
}

/** Delete a video from Stream. A 404 (already gone) counts as success. */
export async function deleteFromStream(uid: string): Promise<void> {
  const account = accountId();
  const token = apiToken();
  if (!account || !token) {
    throw new Error(
      "Cloudflare Stream is not configured (CLOUDFLARE_STREAM_API_TOKEN / account id)"
    );
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/stream/${uid}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok && res.status !== 404) {
    throw new Error(`Stream delete failed: HTTP ${res.status}`);
  }
}
