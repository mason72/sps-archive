/**
 * A `fetch` whose every call is cut off at the EARLIER of a per-call limit and
 * one absolute deadline shared by all calls. A run of slow answers (a burst of
 * gateway 504s, each just under the per-call limit) therefore cannot add up
 * past the deadline: once it has passed, every call aborts at once.
 *
 * The Scout clip route gives its post-pipeline database writes a deadline that
 * ends before its own platform limit, so a slow database can fail the request
 * cleanly instead of having it killed halfway through a write.
 */
export function deadlineFetch(
  deadlineAt: number,
  { perCallMs = 30_000, now = Date.now, fetchImpl = fetch }: {
    perCallMs?: number;
    now?: () => number;
    fetchImpl?: typeof fetch;
  } = {}
): typeof fetch {
  return (input, init) => {
    const left = deadlineAt - now();
    if (left <= 0) {
      return Promise.reject(new DOMException("deadline passed before the call", "TimeoutError"));
    }
    const limit = AbortSignal.timeout(Math.min(perCallMs, left));
    const signal = init?.signal ? AbortSignal.any([init.signal, limit]) : limit;
    return fetchImpl(input, { ...init, signal });
  };
}
