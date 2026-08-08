/**
 * Upload backpressure policy.
 *
 * Presigning creates a DB row before its binary exists, so every presigned-but-
 * not-yet-uploaded file is a row that becomes a ghost if the session dies. The
 * presign loop used to run flat out: a 3,839-file drop minted every row in
 * three minutes for a job that drains at ~40/min, leaving ~90 minutes in which
 * thousands of reserved rows existed only in one tab's memory. The tab died at
 * 2:38am and took the queue with it — 404 photos never uploaded, 12 people left
 * with nothing in their gallery (HDC // 2026, 2026-08-08).
 *
 * The fix is to make the producer wait on the consumer. This lives in its own
 * module so the property that prevents that incident is a tested unit rather
 * than an inline `while` in a 1,300-line component.
 */

/**
 * Never mint a new presign chunk while the queue already holds this many
 * un-started tasks. Sits comfortably above MAX_CONCURRENT_UPLOADS (12) so
 * workers never starve waiting on a presign round-trip, while capping exposure
 * at roughly one chunk's worth of rows — seconds of loss, not hours.
 */
export const PRESIGN_QUEUE_HIGH_WATER = 60;

/** How often the presign loop re-checks for queue room. */
export const PRESIGN_WAIT_POLL_MS = 250;

/**
 * Block until the upload queue has room for another presign chunk, or until the
 * session aborts.
 *
 * Both inputs are READ FUNCTIONS, not values — the queue drains on another
 * task, so a snapshot taken at call time would never change and this would
 * either return immediately or hang forever.
 *
 * If workers stall permanently this never resolves, and that is correct: the
 * loop stops reserving rows it cannot fill. Callers re-check their abort flag
 * after awaiting.
 */
export async function waitForQueueRoom(
  queueDepth: () => number,
  aborted: () => boolean,
  opts: { highWater?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<void> {
  const highWater = opts.highWater ?? PRESIGN_QUEUE_HIGH_WATER;
  const pollMs = opts.pollMs ?? PRESIGN_WAIT_POLL_MS;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  while (!aborted() && queueDepth() >= highWater) {
    await sleep(pollMs);
  }
}
