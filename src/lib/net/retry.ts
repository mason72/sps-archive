/**
 * Retrying the brief network failures a long import meets.
 *
 * Why this exists (2026-11-20): three SPS pulls ran side by side for hours and
 * logged 91 failed photos out of ~8,600. None of them was a bad photo. 56 were
 * `ConnectTimeoutError` opening a connection to our own Supabase (the database
 * was at 16 of 120 connections and nowhere near a limit), 33 were a bare
 * undici "fetch failed" on the SPS download, and 2 were an SPS 500. Every one
 * would have worked a second later. Worse, 31 of them failed AFTER the photo's
 * row was written, on the write that marks it complete, so the photo sat
 * "pending" with no thumbnail and the closing sweep (which looks for rows)
 * counted it as present.
 *
 * So: retry what is plainly the network, a couple of times, quickly. Never
 * retry what is plainly the data (a constraint violation, a statement timeout,
 * a 4xx) - retrying those only adds load or hides a real bug.
 *
 * Retrying a WRITE is only safe when a repeat cannot double it. Updates here
 * are idempotent. Inserts are not, and the caller must handle "my first try
 * actually landed" (see importOneImage: it looks its own row up by id).
 */

/** Waits before the 2nd and 3rd attempt. Three tries in all. */
export const RETRY_DELAYS_MS: readonly number[] = [1_000, 3_000];

/**
 * Socket-level codes that mean "no answer arrived", from undici (Node's fetch)
 * and the OS. A request that hit one of these may or may not have reached the
 * server, which is why inserts need their own landed-check.
 */
const TRANSIENT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
]);

/** An HTTP answer we chose to throw on, kept typed so retry can read the status. */
export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpStatusError";
  }
}

/**
 * True for a thrown error that is the network, not the data.
 *
 * Deliberately NOT a `TimeoutError` from `AbortSignal.timeout`: that is our
 * own ceiling (two minutes on an SPS download), and retrying it would turn one
 * stalled file into six minutes of a slice's 800-second budget.
 */
export function isTransientThrow(err: unknown): boolean {
  if (err instanceof HttpStatusError) {
    return err.status >= 500 || err.status === 429;
  }
  if (!(err instanceof Error)) return false;
  // undici's fetch: TypeError("fetch failed") with the socket error on .cause,
  // or TypeError("terminated") when the body stream dies part-way.
  if (err.name === "TypeError" && (err.message === "fetch failed" || err.message === "terminated")) {
    return true;
  }
  const code =
    (err as { code?: unknown }).code ??
    (err.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

/**
 * True for a supabase-js result that is the network, not the data.
 *
 * postgrest-js never throws on a network failure: it RETURNS
 * `{ error: { message: "TypeError: fetch failed", code: "" }, status: 0 }`.
 * Status 0 is the tell. 502/503/504 are the API gateway in front of the
 * database. A 500 is Postgres itself (a statement timeout is 500 with code
 * 57014) and is NOT retried: that is load, and retrying adds to it.
 */
export function isTransientResult(res: { error: unknown; status?: number }): boolean {
  if (!res.error) return false;
  const status = res.status;
  return status === 0 || status === 502 || status === 503 || status === 504;
}

export interface RetryOptions {
  delays?: readonly number[];
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** ±25% so six workers that failed together do not retry in lockstep. */
const jitter = (ms: number) => Math.round(ms * (0.75 + Math.random() * 0.5));

/** Run `op`; when it throws something transient, wait and run it again. */
export async function retryThrown<T>(
  op: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= delays.length || !isTransientThrow(err)) throw err;
      await sleep(jitter(delays[attempt]));
    }
  }
}

/**
 * Run a supabase-js call; when its RESULT is a network failure, wait and run
 * it again. Returns the last result, error or not, for the caller to judge.
 */
export async function retryResult<R extends { error: unknown; status?: number }>(
  op: () => PromiseLike<R>,
  opts: RetryOptions = {}
): Promise<R> {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? realSleep;
  for (let attempt = 0; ; attempt++) {
    const res = await op();
    if (attempt >= delays.length || !isTransientResult(res)) return res;
    await sleep(jitter(delays[attempt]));
  }
}
