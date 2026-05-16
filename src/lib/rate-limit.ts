/**
 * In-memory sliding-window rate limiter.
 *
 * Tracks request counts per key within a moving time window. Suitable for
 * single-instance / low-traffic deployments. When we outgrow this (multiple
 * Vercel regions or higher traffic), swap the storage for Upstash Redis —
 * the function signature here matches `@upstash/ratelimit`'s `limit()`.
 *
 * Limitations: keys live in process memory, so different serverless
 * instances each have their own counter. The audit accepts this as Phase 0
 * given the few-users state of the app.
 */

type Bucket = {
  /** Sliding window — array of timestamps (ms since epoch). */
  hits: number[];
};

const buckets = new Map<string, Bucket>();

/** Discard buckets nobody has touched in a while so the map doesn't grow forever. */
function gc(now: number) {
  if (buckets.size < 1024) return;
  for (const [key, bucket] of buckets) {
    const fresh = bucket.hits.some((t) => now - t < 60 * 60 * 1000);
    if (!fresh) buckets.delete(key);
  }
}

export interface RateLimitResult {
  /** True if the request is within the allowed budget. */
  success: boolean;
  /** Configured limit. */
  limit: number;
  /** Remaining attempts in this window. */
  remaining: number;
  /** When the bucket will allow the next attempt (ms since epoch). */
  reset: number;
}

/**
 * Apply a sliding-window rate limit.
 *
 * @param key      Bucket identifier (e.g. `verify:<ip>:<slug>`).
 * @param limit    Max hits in `windowMs`.
 * @param windowMs Window length in milliseconds.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  gc(now);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return {
      success: false,
      limit,
      remaining: 0,
      reset: oldest + windowMs,
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  return {
    success: true,
    limit,
    remaining: limit - bucket.hits.length,
    reset: now + windowMs,
  };
}

/**
 * Best-effort client IP extraction. Prefers x-forwarded-for (Vercel and most
 * proxies), falls back to x-real-ip, then a placeholder so we still create
 * SOME bucket. The placeholder means a missing header collapses all callers
 * into one shared bucket — strict, but safe.
 */
export function clientIp(req: { headers: Headers }): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}
