/**
 * Move old ORIGINALS to R2 Infrequent Access (built 2026-10-20).
 *
 * Why: the bucket is ~96% originals (4.26 of 4.43 TB, measured 2026-10-20),
 * and originals are rarely read. AI, faces and the grids read the 800px
 * thumb-lg; originals are read by downloads, ZIPs, the guest lightbox, cover
 * heroes and thumbnail rebuilds. Infrequent Access stores for $0.010 instead
 * of $0.015 per GB-month but charges $0.01/GB on every read and a 30-day
 * minimum, so only originals that have gone quiet should move.
 *
 * The walk reads the BUCKET, not the images table: R2's listing reports each
 * object's LastModified and StorageClass, so "old enough" and "already moved"
 * come from the record itself, with no index on a 1.5M-row table and no
 * per-object HEAD. It walks `events/` in key order, jumps over each event's
 * thumbnails/ (and the small folders before originals/), and resumes from a
 * cursor in ops_config, wrapping to the start when it reaches the end.
 *
 * Re-running is harmless: a moved object lists as STANDARD_IA and is skipped,
 * and every copy is guarded by the ETag it was listed with. An overwritten
 * original lists as STANDARD with a fresh LastModified, so it waits 30 days
 * again on its own.
 *
 * Kept on the normal tier on purpose: videos (MP4 originals stream on every
 * play), website-published photos (the site lane re-copies them), cover
 * uploads, and anything under 1 MiB (the $9/M copy takes months to repay).
 *
 * Cost trap: any job that re-reads originals across the archive (a thumbnail
 * rebuild, `verify-pixieset-ingest --all`) pays $0.01/GB for the moved ones,
 * about $43 for the whole archive. See docs/OPS.md "R2 bill and storage tiers".
 */

export const IA_AFTER_DAYS = 30;
export const IA_MIN_BYTES = 1024 * 1024;
export const IA_PREFIX = "events/";
export const IA_CURSOR_KEY = "r2-ia-tiering";

const ORIGINALS = "originals";
const ORIGINAL_KEY = /^events\/[^/]+\/originals\/[^/].*$/;
const VIDEO_EXT = /\.(mp4|mov)$/i;

export function isIaTieringEnabled(): boolean {
  return process.env.R2_IA_TIERING_ENABLED === "true";
}

export interface ListedObject {
  Key?: string;
  Size?: number;
  LastModified?: Date;
  StorageClass?: string;
  ETag?: string;
}

export type Verdict =
  | "move"
  | "already"
  | "young"
  | "small"
  | "video"
  | "excluded"
  | "unknown"
  | "not-original";

/** What to do with one listed object. Pure. */
export function classifyForIa(o: ListedObject, now: Date, excluded: ReadonlySet<string>): Verdict {
  const key = o.Key ?? "";
  if (!ORIGINAL_KEY.test(key)) return "not-original";
  if (o.StorageClass === "STANDARD_IA") return "already";
  if (VIDEO_EXT.test(key)) return "video";
  if (excluded.has(key)) return "excluded";
  if ((o.Size ?? 0) < IA_MIN_BYTES) return "small";
  // Missing age or ETag is not evidence of anything: leave the object alone
  // (without the ETag the copy could not be guarded against an overwrite).
  if (!o.LastModified || !o.ETag) return "unknown";
  const cutoff = now.getTime() - IA_AFTER_DAYS * 24 * 60 * 60 * 1000;
  if (o.LastModified.getTime() > cutoff) return "young";
  return "move";
}

/**
 * Where the next listing starts after a page ending at `lastKey`. Before an
 * event's originals/ (attachments, branding, covers) it jumps INTO originals/;
 * past it (thumbnails, video) it jumps past the whole event folder. Pure.
 *
 * Folder names are compared WITH their trailing slash, as the listing orders
 * them: "originals-old/" sorts before "originals/" because "-" < "/". The jump
 * past an event is `events/<id>0` ("0" is the character after "/"), which is
 * greater than every key inside the folder whatever its folder names are.
 */
export function nextStartAfter(lastKey: string): string {
  const [root, eventId, segment, ...rest] = lastKey.split("/");
  if (root !== "events" || !eventId || segment === undefined || rest.length === 0) return lastKey;
  const folder = `${segment}/`;
  if (folder < `${ORIGINALS}/`) return `events/${eventId}/${ORIGINALS}/`;
  if (folder > `${ORIGINALS}/`) return `events/${eventId}0`;
  return lastKey;
}

/** A page counts as a systemic failure only when this many copies ALL failed. */
export const IA_STALL_MIN_FAILURES = 5;

export interface TieringDeps {
  list(startAfter: string | undefined): Promise<{ objects: ListedObject[]; truncated: boolean }>;
  copyToIa(key: string, etag: string): Promise<void>;
}

export interface PassResult {
  pages: number;
  listed: number;
  moved: number;
  movedBytes: number;
  counts: Partial<Record<Verdict | "changed" | "gone", number>>;
  failed: { key: string; error: string }[];
  /** Resume point for the next pass; null = the walk reached the end and wraps. */
  cursor: string | null;
  wrapped: boolean;
  /** True when a page's copies ALL failed (and there were several): the cursor stays put. */
  stalled: boolean;
  /** True when the pass stopped because its time budget ran out (between pages, or cut mid-page). */
  outOfTime: boolean;
}

function errorName(err: unknown): string {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name ?? String(e?.$metadata?.httpStatusCode ?? "error");
}

/** Run `fn` over `items`, `size` at a time; stop TAKING items once `stop()` says so. Returns true if every item ran. */
async function pool<T>(
  items: T[],
  size: number,
  fn: (t: T) => Promise<void>,
  stop: () => boolean = () => false
): Promise<boolean> {
  let next = 0;
  let cut = false;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      if (stop()) {
        cut = true;
        return;
      }
      await fn(items[next++]);
    }
  });
  await Promise.all(workers);
  return !cut;
}

/**
 * Walk up to `maxPages` listing pages from `startAfter`, moving what qualifies,
 * and stop starting new pages once `deadline` (epoch ms) has passed.
 * A copy refused because the object changed (412) or vanished (404) is skipped,
 * not failed. Other failures are reported; their objects stay STANDARD and are
 * picked up on the next lap. If a page had IA_STALL_MIN_FAILURES or more
 * copies and every one failed, the walk stops where it was (a systemic fault
 * should not sweep the whole bucket failing); one bad object is stepped past.
 * `onPage` runs after every page with the result so far, so a caller can save
 * the cursor before the next page starts.
 */
export async function runTieringPass(
  deps: TieringDeps,
  opts: {
    startAfter: string | null;
    excluded: ReadonlySet<string>;
    now: Date;
    maxPages: number;
    deadline?: number;
    /**
     * Mid-page cut-off (epoch ms): no new copy starts after it, and the cursor
     * stays BEFORE the page so it is re-listed (moved objects then list as
     * STANDARD_IA and are skipped). Keeps a slow R2 from pushing a step past
     * its platform limit.
     */
    hardDeadline?: number;
    /** Epoch-ms clock for the deadlines (tests pass a fake one). */
    clock?: () => number;
    concurrency?: number;
    onPage?: (soFar: PassResult) => Promise<void>;
  }
): Promise<PassResult> {
  const result: PassResult = {
    pages: 0,
    listed: 0,
    moved: 0,
    movedBytes: 0,
    counts: {},
    failed: [],
    cursor: opts.startAfter,
    wrapped: false,
    stalled: false,
    outOfTime: false,
  };
  const bump = (k: keyof PassResult["counts"]) => (result.counts[k] = (result.counts[k] ?? 0) + 1);

  const clock = opts.clock ?? Date.now;
  let startAfter = opts.startAfter ?? undefined;
  while (result.pages < opts.maxPages) {
    if (opts.deadline !== undefined && clock() >= opts.deadline) {
      result.outOfTime = true;
      return result;
    }
    const page = await deps.list(startAfter);
    result.pages += 1;
    result.listed += page.objects.length;

    const toMove: ListedObject[] = [];
    for (const o of page.objects) {
      const v = classifyForIa(o, opts.now, opts.excluded);
      if (v === "move") toMove.push(o);
      else if (v !== "not-original") bump(v);
    }

    let pageMoved = 0;
    let pageFailed = 0;
    const hard = opts.hardDeadline;
    const finished = await pool(toMove, opts.concurrency ?? 16, async (o) => {
      try {
        await deps.copyToIa(o.Key!, o.ETag!);
        pageMoved += 1;
        result.moved += 1;
        result.movedBytes += o.Size ?? 0;
      } catch (err) {
        const name = errorName(err);
        const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
        if (name === "PreconditionFailed" || status === 412) bump("changed");
        else if (name === "NoSuchKey" || name === "NotFound" || status === 404) bump("gone");
        else {
          pageFailed += 1;
          result.failed.push({ key: o.Key!, error: `${name}: ${(err as Error)?.message ?? ""}`.slice(0, 200) });
        }
      }
    }, () => hard !== undefined && clock() >= hard);

    if (!finished) {
      // Cut mid-page: leave the cursor before this page so it is re-listed.
      result.outOfTime = true;
      result.cursor = startAfter ?? null;
      return result;
    }

    if (pageFailed >= IA_STALL_MIN_FAILURES && pageMoved === 0) {
      result.stalled = true;
      result.cursor = startAfter ?? null;
      return result;
    }

    const last = page.objects[page.objects.length - 1]?.Key;
    if (!page.truncated || !last) {
      result.cursor = null;
      result.wrapped = true;
      await opts.onPage?.(result);
      return result;
    }
    // A jump must move forward; if it would not (a key shape this code did
    // not foresee), resume after the last key instead of re-reading the page.
    const jump = nextStartAfter(last);
    startAfter = jump > last ? jump : last;
    result.cursor = startAfter;
    await opts.onPage?.(result);
  }
  return result;
}
