"use client";

/**
 * UploadManager — the upload engine, lifted above the pages.
 *
 * It used to live inside UploadZone, which the event page mounts with
 * `key={uploadTargetId}`. That key changes whenever the active section changes,
 * so React destroyed and rebuilt the component — and the in-memory work queue
 * with it — when you merely clicked a section in the sidebar. No warning fired,
 * because `beforeunload`/`pagehide` are PAGE events and a React unmount is not
 * one; the queued rows were left behind as ghosts (110 of them on
 * "Jessica & Koji's Big Day", 2026-08-08).
 *
 * So the engine now lives in the root layout and the views are disposable. A
 * BATCH is one drop, pinned at drop time to {eventId, sectionId}; several can
 * run at once against different sections, which is the "dump this folder and
 * keep organizing" workflow. Uploads survive section switches and any in-app
 * navigation. Closing the tab still ends them — no browser can upload from a
 * dead tab — so the unload warning stays.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { extractExif } from "@/lib/upload/parse-filename";
import { isVideoMime } from "@/lib/upload/media";
import { waitForQueueRoom } from "@/lib/upload/backpressure";

const PRESIGN_CHUNK = 50;
/** Workers are a GLOBAL budget: N batches share one uplink, not N uplinks. */
/**
 * 6, down from 12 (2026-08-16). Throughput is uplink-bound, so halving the
 * workers costs nothing measurable — but 12 concurrent same-origin request
 * bodies is exactly where Safari's network stack starts shedding requests
 * ("Load failed" on fetches that lose the scheduling fight), and every shed
 * request here has a blast radius: a lost presign fails a whole chunk, a lost
 * refresh used to kill the page. Six is the per-host ceiling every browser is
 * comfortable with, and it leaves headroom for the page's own traffic.
 */
const MAX_CONCURRENT_UPLOADS = 6;
/**
 * How often coalesced file patches reach React state. See `pendingPatches` for
 * why this exists at all — 100ms is ~10 updates/sec, smooth for a progress bar
 * and roughly 24x fewer state writes than one-per-XHR-progress-event.
 */
const PATCH_FLUSH_MS = 100;
const R2_PUT_RETRIES = 2;
/**
 * Network-failed tasks go to the BACK OF THE QUEUE this many times before the
 * file is marked failed. The in-place retry loop above spans only ~7 seconds
 * (1s/2s/4s backoff), which is SHORTER than the congestion burst that caused
 * the failure — Safari sheds a few requests under sustained upload load, and
 * all three attempts land inside the same weather. Requeueing spreads the next
 * try across the natural drain of the queue (minutes on a big drop), which is
 * the correct backoff scale. 46 of Mason's 370 were failing terminally on
 * hiccups the very next pass would have absorbed (2026-08-16).
 */
const MAX_REQUEUES = 2;
const R2_RETRY_BASE_MS = 1000;
const R2_PUT_TIMEOUT_MS = 120_000;
const MIN_UPLOAD_BYTES_PER_SEC = 250 * 1024;
const PROXY_MAX_BYTES = 4 * 1024 * 1024;
const CORS_FAILURE_THRESHOLD = 3;
/**
 * Files at or under this size have their bytes read into memory BEFORE the
 * PUT — see the snapshot block in uploadOne (the Dropbox stale-handle fix).
 * Above it (long videos), the File streams as before: 6 workers × 500 MB in
 * RAM would be its own incident.
 */
const SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
const EXIF_SCAN_BYTES = 4 * 1024 * 1024;
const KEEPALIVE_BYTE_BUDGET = 50 * 1024;

export const unfinishedKey = (eventId: string) =>
  `pixeltrunk:unfinished:${eventId}`;
export const unfinishedDismissedKey = (eventId: string) =>
  `pixeltrunk:unfinished-dismissed:${eventId}`;
const UNFINISHED_SAVE_MS = 2000;

function uploadTimeoutMs(fileSize: number): number {
  return Math.max(
    R2_PUT_TIMEOUT_MS,
    Math.round((fileSize / MIN_UPLOAD_BYTES_PER_SEC) * 1000)
  );
}

export type FileStatus =
  | "pending"
  | "uploading"
  | "complete"
  | "error"
  /** Same name AND size already in THIS section. Offers replace-or-skip. */
  | "duplicate"
  /**
   * Already in the event but not in this section, so it was LINKED here — one
   * image, now in both places, no second copy of the bytes.
   *
   * Deliberately NOT "duplicate": that status feeds the replace-or-skip panel,
   * and offering to "replace" a photo that was just correctly added would delete
   * the original to re-upload an identical one.
   */
  | "linked"
  /**
   * Refused at the door — camera raw, PSD, HEIC, or past a size cap. Nothing
   * was attempted and nothing broke, so it is NOT "error": that status offers
   * Retry, and retrying a file the validator rejects is a loop that can only
   * end the same way. The one useful action is to clear the note.
   *
   * These rows never enter a batch, so they live in UploadZone's own `rejected`
   * list and never reach the queue, the presign route, or a database row.
   */
  | "incompatible";

export interface UploadFile {
  id: string;
  file: File;
  previewUrl: string;
  status: FileStatus;
  progress: number;
  error?: string;
  imageId?: string;
  existingImageIds?: string[];
  finalizeNeeded?: boolean;
}

export interface Batch {
  id: string;
  eventId: string;
  /** Gallery name, so the dock can say WHICH gallery is uploading. */
  eventName: string | null;
  /** Pinned at drop time — a drop goes where it was dropped. */
  sectionId: string | null;
  sectionName: string | null;
  files: UploadFile[];
  createdAt: number;
}

interface UploadTask {
  batchId: string;
  fileId: string;
  file: File;
  imageId: string;
  uploadUrl: string;
  /** How many times this task has been sent to the back of the queue after a
      network-layer failure. Terminal only past MAX_REQUEUES. */
  requeues?: number;
  /**
   * The bytes are already in storage; only the confirm POST is owed. A task
   * re-enters the queue with this set when its finalize failed after in-place
   * retries — the worker then skips the snapshot and the PUT entirely and
   * just re-confirms. Without this, a requeued finalize would re-upload the
   * whole file to pay off a 1 KB request.
   */
  finalizeOnly?: boolean;
}

export type UploadEvent =
  | { type: "image-uploaded"; eventId: string }
  | { type: "batch-complete"; eventId: string; imageIds: string[] }
  | { type: "batch-failed"; eventId: string; files: File[] };

/** PUT with real progress events (fetch exposes none). */
function putWithProgress(
  url: string,
  file: Blob,
  opts: {
    timeoutMs: number;
    signal: { aborted: boolean };
    onProgress: (pct: number, loadedBytes: number) => void;
  }
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.timeout = opts.timeoutMs;
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100), e.loaded);
      }
    };
    xhr.onload = () => {
      opts.onProgress(100, file.size);
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    };
    xhr.onerror = () => reject(new TypeError("Failed to fetch"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("aborted"));
    const abortPoll = setInterval(() => {
      if (opts.signal.aborted) {
        clearInterval(abortPoll);
        xhr.abort();
      }
    }, 250);
    xhr.addEventListener("loadend", () => clearInterval(abortPoll));
    xhr.send(file);
  });
}

/**
 * Delete presign-created rows for files that will never upload. On pagehide the
 * page is dying, so requests must be `keepalive` — whose bodies share a 64 KB
 * budget across all in-flight keepalive requests. Budget the BYTES; the
 * overflow is the nightly reconciler's job.
 */
function deleteRowsInBatches(imageIds: string[], duringUnload: boolean): void {
  if (imageIds.length === 0) return;
  let budget = duringUnload ? KEEPALIVE_BYTE_BUDGET : Infinity;
  for (let s = 0; s < imageIds.length; s += 500) {
    const body = JSON.stringify({ imageIds: imageIds.slice(s, s + 500) });
    if (duringUnload) {
      if (body.length > budget) return;
      budget -= body.length;
    }
    fetch("/api/images/batch", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: duringUnload,
    }).catch(() => {
      /* the nightly reconciler is the backstop */
    });
  }
}

interface UploadManagerValue {
  batches: Batch[];
  /** Bytes/sec smoothed, in Mbps. Null when idle. */
  speedMbps: number | null;
  corsError: boolean;
  startBatch: (input: {
    eventId: string;
    eventName?: string | null;
    sectionId: string | null;
    sectionName: string | null;
    files: File[];
  }) => Promise<void>;
  cancelBatch: (batchId: string) => void;
  updateFile: (batchId: string, fileId: string, patch: Partial<UploadFile>) => void;
  removeFiles: (batchId: string, fileIds: Set<string>) => void;
  uploadEntries: (batchId: string, entries: UploadFile[]) => Promise<void>;
  retryFinalize: (batchId: string, entry: UploadFile) => Promise<void>;
  subscribe: (handler: (e: UploadEvent) => void) => () => void;
}

const Ctx = createContext<UploadManagerValue | null>(null);

export function useUploadManager(): UploadManagerValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useUploadManager must be used inside UploadManagerProvider");
  return ctx;
}

/** Per-target-section slice of an event's upload progress. Computed from the
 *  same state on the same render as the event totals, so every consumer
 *  (dropzone bar, sidebar rows, dock) ticks on the same heartbeat. */
export interface SectionUploadProgress {
  sectionId: string | null;
  sectionName: string | null;
  /**
   * Denominator: every file bound for this section, as dropped.
   *
   * It used to exclude duplicates and hard failures so the ring could close at
   * 100%. That bought a tidy ring at the cost of the number meaning anything —
   * the total shrank while the upload ran, which is the single thing a progress
   * count must never do. The ring closes because everything reaches a terminal
   * state, not because the denominator retreats to meet it.
   */
  total: number;
  /** Reached a good terminal state: uploaded, or already present (settled). */
  completed: number;
  failed: number;
  /** Already in the event — linked into this section, or nothing to do. */
  settled: number;
  inFlight: number;
}

/** Aggregate progress for one event — what the page's unified bar reads. */
export function useEventUploadProgress(eventId: string) {
  const { batches } = useUploadManager();
  return useMemo(() => {
    const mine = batches.filter((b) => b.eventId === eventId);
    const files = mine.flatMap((b) => b.files);
    // THE DENOMINATOR IS WHAT YOU DROPPED. It used to exclude duplicates, and
    // the per-section loop below also dropped failures, so the total shrank as
    // the upload ran — 1,106 became 1,090 while Justin watched (2026-08-11).
    // Every file lands in exactly one terminal state and every one of them is
    // accounted for; none of them stops being a file you handed over.
    const counted = files;
    const inFlight = files.filter(
      (f) => f.status === "pending" || f.status === "uploading"
    ).length;

    const bySection = new Map<string, SectionUploadProgress>();
    for (const b of mine) {
      const key = b.sectionId ?? "__event__";
      const entry =
        bySection.get(key) ??
        ({
          sectionId: b.sectionId,
          sectionName: b.sectionName,
          total: 0,
          completed: 0,
          failed: 0,
          settled: 0,
          inFlight: 0,
        } satisfies SectionUploadProgress);
      for (const f of b.files) {
        // Everything counts toward the total, including failures and files that
        // were already here — the section still owes an account of each one.
        entry.total += 1;
        if (f.status === "error") {
          entry.failed += 1;
          continue;
        }
        // "Settled" covers already-present photos: linked into this section or
        // genuinely nothing to do. No bytes move, but they ARE resolved, so
        // they count as finished rather than as work still outstanding.
        if (f.status === "duplicate" || f.status === "linked") {
          entry.settled += 1;
          entry.completed += 1;
          continue;
        }
        if (f.status === "complete") entry.completed += 1;
        if (f.status === "pending" || f.status === "uploading")
          entry.inFlight += 1;
      }
      bySection.set(key, entry);
    }

    return {
      active: inFlight > 0,
      total: counted.length,
      uploaded: files.filter((f) => f.status === "complete").length,
      failed: files.filter((f) => f.status === "error").length,
      /** Already in the event — linked into the section, or nothing to do. */
      settled: files.filter(
        (f) => f.status === "duplicate" || f.status === "linked"
      ).length,
      /**
       * Dropped files that have NO database row yet — presign hasn't reached
       * them.
       *
       * Presign is throttled on purpose (a 60-task high-water mark, after the
       * HDC incident where 3,839 rows were minted in three minutes for a queue
       * draining at 40/min and a dead tab took 404 photos with it). The
       * consequence is that rows appear at upload pace: Justin's 1,142 files
       * took FIFTY MINUTES to fully register. Anything planning from the
       * database mid-upload is therefore planning over a fraction of the drop
       * — which is why the sort preview's "every file is already counted"
       * was untrue. The browser has known every filename since the drop, so it
       * can supply the rest.
       */
      unregistered: files
        .filter((f) => !f.imageId && f.status !== "error")
        .map((f) => ({ id: f.id, originalFilename: f.file.name })),
      inFlight,
      bySection,
    };
  }, [batches, eventId]);
}

export function UploadManagerProvider({ children }: { children: React.ReactNode }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [speedMbps, setSpeedMbps] = useState<number | null>(null);
  const [corsError, setCorsError] = useState(false);

  const batchesRef = useRef<Batch[]>([]);
  batchesRef.current = batches;

  /** Per-batch queues; workers round-robin so no batch starves another. */
  const queues = useRef<Map<string, UploadTask[]>>(new Map());
  const aborted = useRef<Set<string>>(new Set());
  const activeWorkers = useRef(0);
  const rrCursor = useRef(0);
  const bytesSentRef = useRef(0);
  const corsFailureCount = useRef(0);
  /**
   * Set the moment any DIRECT (>4 MB, straight-to-R2) PUT succeeds. This is
   * the one honest discriminator for the CORS banner: a bucket with no CORS
   * policy fails EVERY direct PUT from the first one — so if even one has
   * landed, later network errors are weather, not configuration. The banner
   * fired mid-drop on Mason's fully-configured bucket (2026-08-16) because
   * three Safari-shed requests matched the "3 TypeErrors" heuristic, and it
   * told him to go reconfigure Cloudflare while 4 MB+ files were landing in
   * the same minute.
   */
  const directPutOk = useRef(false);
  const objectUrls = useRef<Set<string>>(new Set());
  const completedIds = useRef<Map<string, string[]>>(new Map());
  const failedFiles = useRef<Map<string, File[]>>(new Map());
  const listeners = useRef<Set<(e: UploadEvent) => void>>(new Set());

  const emit = useCallback((e: UploadEvent) => {
    listeners.current.forEach((fn) => {
      try {
        fn(e);
      } catch {
        /* a bad subscriber must not stall an upload */
      }
    });
  }, []);

  const subscribe = useCallback((handler: (e: UploadEvent) => void) => {
    listeners.current.add(handler);
    return () => {
      listeners.current.delete(handler);
    };
  }, []);

  /**
   * Pending file patches, coalesced and flushed on a timer.
   *
   * WHY THIS EXISTS — the 2026-08-16 upload wedge. `updateFile` used to call
   * `setBatches` directly, and it is called from `onProgress`, which XHR fires
   * roughly every 50ms PER REQUEST. With 12 concurrent workers that is ~240
   * state writes a second, and each one rebuilt the whole structure: a map over
   * every batch, and a full re-map of the target batch's files array, allocating
   * a new object per file. Cost per tick is O(total files staged), not O(1).
   *
   * Mason dropped 1,197 photos "rapid fire ... from different folders", which
   * is exactly the shape that detonates it: ~36 concurrent batches, ~2,600 files
   * in state, so every one of those 240 writes/sec re-allocated 2,600 objects
   * and re-rendered the dock. The main thread never came up for air.
   *
   * It was NOT a deadlock, which is why it was so hard to read — it was a
   * LIVELOCK, and every symptom followed from a starved main thread:
   *   - "I typed Stylists and pressed ENTER, nothing happened" — the POST fired
   *     and SUCCEEDED (17:15:07); React just never got a frame to render the
   *     new section, so he pressed Enter four more times and the server
   *     answered 23505 duplicate-key four times.
   *   - "everything seemed stuck" — uploads crawled because XHR completion
   *     callbacks queue behind React work, so workers rarely finished and the
   *     presign loops all parked at their high-water mark (52 chunks in 25 min).
   *   - Vercel logs were CLEAN. The server was healthy throughout. A wedge with
   *     no server error and no client error is the signature of a busy loop.
   *
   * The fix is to make cost proportional to FRAMES, not to ticks: collect
   * patches in a ref and apply them all in ONE pass at ~10Hz. 240 writes/sec
   * over 2,600 files becomes 10 writes/sec, and each flush touches the state
   * once no matter how many files changed in that window.
   *
   * A TIMER, not requestAnimationFrame, on purpose: rAF does not fire in a
   * background tab, and uploads are exactly what people leave running in one.
   * Progress would freeze and terminal statuses would sit unapplied until they
   * came back. 100ms is smooth for a progress bar and keeps firing when hidden.
   */
  const pendingPatches = useRef<Map<string, Map<string, Partial<UploadFile>>>>(
    new Map()
  );
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPatches = useCallback(() => {
    if (flushTimer.current !== null) {
      clearTimeout(flushTimer.current);
      flushTimer.current = null;
    }
    const pending = pendingPatches.current;
    if (pending.size === 0) return;
    pendingPatches.current = new Map();
    setBatches((prev) =>
      prev.map((b) => {
        const forBatch = pending.get(b.id);
        if (!forBatch) return b;
        return {
          ...b,
          files: b.files.map((f) => {
            const patch = forBatch.get(f.id);
            return patch ? { ...f, ...patch } : f;
          }),
        };
      })
    );
  }, []);

  const updateFile = useCallback(
    (batchId: string, fileId: string, patch: Partial<UploadFile>) => {
      let forBatch = pendingPatches.current.get(batchId);
      if (!forBatch) {
        forBatch = new Map();
        pendingPatches.current.set(batchId, forBatch);
      }
      // Merge, never replace: a progress tick must not drop a status set
      // earlier in the same window, and vice versa.
      forBatch.set(fileId, { ...(forBatch.get(fileId) ?? {}), ...patch });
      if (flushTimer.current === null) {
        flushTimer.current = setTimeout(flushPatches, PATCH_FLUSH_MS);
      }
    },
    [flushPatches]
  );

  useEffect(() => {
    return () => {
      if (flushTimer.current !== null) clearTimeout(flushTimer.current);
    };
  }, []);

  const removeFiles = useCallback((batchId: string, fileIds: Set<string>) => {
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== batchId) return b;
        b.files.forEach((f) => {
          if (fileIds.has(f.id) && f.previewUrl) {
            URL.revokeObjectURL(f.previewUrl);
            objectUrls.current.delete(f.previewUrl);
          }
        });
        return { ...b, files: b.files.filter((f) => !fileIds.has(f.id)) };
      })
    );
  }, []);

  const deleteOrphanRow = useCallback(async (imageId: string) => {
    try {
      await fetch("/api/images/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: [imageId] }),
      });
    } catch {
      /* best-effort cleanup */
    }
  }, []);

  const finalizeUpload = useCallback(
    async (imageId: string, file: File): Promise<boolean> => {
      let exifData: Record<string, unknown> = {};
      if (!isVideoMime(file.type)) {
        try {
          const buf = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
          const exif = await extractExif(buf);
          if (exif) exifData = exif;
        } catch {
          /* EXIF is non-critical */
        }
      }
      const COMPLETE_RETRIES = 2;
      for (let attempt = 0; attempt <= COMPLETE_RETRIES; attempt++) {
        try {
          const res = await fetch("/api/upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageId,
              width: (exifData as { width?: number }).width ?? null,
              height: (exifData as { height?: number }).height ?? null,
              exif: exifData,
            }),
          });
          if (res.ok) return true;
        } catch {
          /* retry */
        }
        if (attempt < COMPLETE_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      return false;
    },
    []
  );

  const cancelTask = useCallback(
    async (task: UploadTask) => {
      removeFiles(task.batchId, new Set([task.fileId]));
      await deleteOrphanRow(task.imageId);
    },
    [removeFiles, deleteOrphanRow]
  );

  const uploadOne = useCallback(
    async (task: UploadTask) => {
      const isAborted = () => aborted.current.has(task.batchId);
      if (isAborted()) return cancelTask(task);

      const batch = batchesRef.current.find((b) => b.id === task.batchId);
      const eventId = batch?.eventId ?? "";
      const useProxy = task.file.size <= PROXY_MAX_BYTES;

      if (task.finalizeOnly) {
        // Bytes already in storage — only the confirm is owed. Skip straight
        // past the snapshot and the PUT; the failure branch below handles the
        // requeue-or-error decision exactly as it does for a fresh task.
        const okFin = await finalizeUpload(task.imageId, task.file);
        if (okFin) {
          updateFile(task.batchId, task.fileId, {
            status: "complete",
            progress: 100,
            imageId: task.imageId,
          });
          const done = completedIds.current.get(task.batchId) ?? [];
          done.push(task.imageId);
          completedIds.current.set(task.batchId, done);
          if (eventId) emit({ type: "image-uploaded", eventId });
          return;
        }
        if ((task.requeues ?? 0) < MAX_REQUEUES) {
          const q = queues.current.get(task.batchId);
          if (q && !aborted.current.has(task.batchId)) {
            q.push({ ...task, requeues: (task.requeues ?? 0) + 1 });
            return;
          }
        }
        const list = failedFiles.current.get(task.batchId) ?? [];
        list.push(task.file);
        failedFiles.current.set(task.batchId, list);
        updateFile(task.batchId, task.fileId, {
          status: "error",
          error: "Uploaded, but not confirmed — retry",
          imageId: task.imageId,
          finalizeNeeded: true,
        });
        return;
      }

      updateFile(task.batchId, task.fileId, { status: "uploading", progress: 0 });
      const target = useProxy ? `/api/upload/${task.imageId}` : task.uploadUrl;

      /**
       * SNAPSHOT THE BYTES BEFORE SENDING — the fix for the Dropbox drops.
       *
       * Mason's staff photos live in Dropbox folders, many as online-only
       * placeholders. Dragging those into the browser hands over a File handle
       * whose bytes may not be on disk yet, and Dropbox touching the file after
       * the drop (sync, materialization) makes the handle STALE — Safari then
       * fails the read mid-send as "Load failed", Chrome as
       * ERR_UPLOAD_FILE_CHANGED. That is why failures were intermittent, why
       * Retry re-failed (same stale handle), and why it never reproduced from
       * a local folder.
       *
       * Reading the file into memory first (a) forces macOS to materialize a
       * cloud placeholder, (b) pins the exact bytes so nothing can change them
       * mid-send, and (c) turns "the source file is unreadable" into its OWN
       * error with its own advice, instead of masquerading as a network
       * failure. Three read attempts with a pause, because materialization is
       * a download that needs a moment.
       *
       * Bounded: videos up to 500 MB keep streaming from the File handle as
       * before — 6 workers × 500 MB in memory would be its own incident.
       */
      let body: Blob = task.file;
      if (task.file.size <= SNAPSHOT_MAX_BYTES) {
        let snapshotted = false;
        for (let attempt = 0; attempt < 3 && !snapshotted; attempt++) {
          if (isAborted()) return cancelTask(task);
          try {
            body = new Blob([await task.file.arrayBuffer()], {
              type: task.file.type,
            });
            snapshotted = true;
          } catch {
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        if (!snapshotted) {
          /**
           * A failed read is NOT proof the file is bad — it is usually proof
           * the TAB is busy. Under a big drop Safari runs out of per-page file
           * resources and refuses opens on files that are verifiably local
           * ("the files are all downloaded and synced" — Mason, 2026-08-16,
           * while reads failed in bulk). So a failed read requeues like a
           * network failure: by the time the queue comes back around, the
           * pressure has drained. Only a file that failed its reads across
           * MAX_REQUEUES separate passes gets the terminal message — and that
           * one names BOTH plausible causes and the fix for each.
           */
          if ((task.requeues ?? 0) < MAX_REQUEUES) {
            updateFile(task.batchId, task.fileId, { status: "pending", progress: 0 });
            const q = queues.current.get(task.batchId);
            if (q && !aborted.current.has(task.batchId)) {
              q.push({ ...task, requeues: (task.requeues ?? 0) + 1 });
              return;
            }
          }
          (failedFiles.current.get(task.batchId) ?? []).push(task.file);
          await deleteOrphanRow(task.imageId);
          updateFile(task.batchId, task.fileId, {
            status: "error",
            // "Drop it again", not "Retry": a Retry re-reads the same dropped
            // file handle, and a handle that failed this many spread-out reads
            // is dead — gone stale (cloud sync touched it) or never local.
            // A fresh drop mints a fresh handle.
            error:
              "Couldn't read this file after several tries — drop it again (if it shows a cloud icon in Finder, download it first)",
          });
          return;
        }
      }

      let ok = false;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= R2_PUT_RETRIES; attempt++) {
        if (isAborted()) return cancelTask(task);
        try {
          let lastPct = -1;
          let lastLoaded = 0;
          const res = await putWithProgress(target, body, {
            timeoutMs: uploadTimeoutMs(task.file.size),
            signal: {
              get aborted() {
                return isAborted();
              },
            },
            onProgress: (pct, loaded) => {
              bytesSentRef.current += Math.max(0, loaded - lastLoaded);
              lastLoaded = loaded;
              if (pct === lastPct) return;
              lastPct = pct;
              updateFile(task.batchId, task.fileId, { progress: pct });
            },
          });
          if (res.ok) {
            ok = true;
            break;
          }
          lastErr = new Error(`Upload failed (${res.status})`);
          /**
           * 404 = the reservation row is GONE (cancelled run, reconciler
           * sweep). No retry of this URL can ever succeed, and hammering it
           * three times with backoff is what produced the repeating 404 bursts
           * in the 2026-08-16 logs. Fail fast; the row-level Retry button
           * re-presigns from scratch (new row, new URL), which is the fix.
           */
          if (res.status === 404) {
            lastErr = new Error("Upload slot expired — Retry re-creates it");
            break;
          }
        } catch (err) {
          lastErr = err;
          /**
           * The CORS counter now only RAISES THE BANNER — it no longer
           * insta-fails files. It used to: three network-shaped errors flipped
           * corsBlockedRef and every later >4 MB file was failed WITHOUT AN
           * ATTEMPT until the tab reloaded. Built for a real misconfigured
           * bucket (a permanent condition), it latched on three Dropbox
           * stale-handle reads — a transient one — and turned "a few cloud
           * files hiccupped" into "everything I drop fails" (Mason,
           * 2026-08-16). Genuinely broken CORS still surfaces: every file
           * fails its own attempts and the banner points at settings. A latch
           * may inform; it must never act.
           */
          if (!useProxy && err instanceof TypeError && !directPutOk.current) {
            // Only while NO direct PUT has ever succeeded — see directPutOk.
            corsFailureCount.current++;
            if (corsFailureCount.current >= CORS_FAILURE_THRESHOLD) {
              setCorsError(true);
            }
          }
        }
        if (attempt < R2_PUT_RETRIES) {
          updateFile(task.batchId, task.fileId, { progress: 0 });
          await new Promise((r) =>
            setTimeout(r, R2_RETRY_BASE_MS * Math.pow(2, attempt))
          );
        }
      }

      if (!ok) {
        if (isAborted()) return cancelTask(task);
        /**
         * A NETWORK failure goes to the back of the queue, not to the
         * graveyard. The in-place retries above span ~7s — inside the same
         * congestion burst that dropped the request in the first place. By the
         * time the queue comes back around (minutes, on a real drop), the
         * weather has changed. The row and presigned URL stay valid (1h), the
         * bytes snapshot is re-read cheaply, and the file simply rides again.
         * Only a task that has been around MAX_REQUEUES times fails for real.
         * Server ANSWERS (4xx/5xx) skip this — re-asking is not a retry, and
         * the 404 fast-fail above already broke out with its own message.
         */
        if (lastErr instanceof TypeError && (task.requeues ?? 0) < MAX_REQUEUES) {
          updateFile(task.batchId, task.fileId, {
            status: "pending",
            progress: 0,
          });
          const q = queues.current.get(task.batchId);
          if (q && !aborted.current.has(task.batchId)) {
            q.push({ ...task, requeues: (task.requeues ?? 0) + 1 });
            return;
          }
        }
        const list = failedFiles.current.get(task.batchId) ?? [];
        list.push(task.file);
        failedFiles.current.set(task.batchId, list);
        // Clean up the pre-created row so a failed upload never leaves a ghost.
        // (This is also the diagnostic that tells a failed upload from one that
        // was never attempted: a surviving "pending" row means never tried.)
        await deleteOrphanRow(task.imageId);
        updateFile(task.batchId, task.fileId, {
          status: "error",
          // The message is the error we actually saw — never the CORS guess.
          // "Network error — Retry" beats a wrong instruction to reconfigure
          // storage that was working a minute ago.
          error:
            lastErr instanceof TypeError
              ? "Network hiccup — Retry"
              : lastErr instanceof Error
              ? lastErr.message
              : "Upload failed",
        });
        return;
      }

      corsFailureCount.current = 0;
      if (!useProxy) {
        // A direct PUT landed, so CORS is provably configured — retire the
        // banner for this session, including one already showing.
        directPutOk.current = true;
        setCorsError(false);
      }

      const finalized = await finalizeUpload(task.imageId, task.file);
      if (!finalized) {
        /**
         * The confirm was the LAST unprotected fetch in the chain, and it
         * showed: a healthy 496-file run still leaked a trickle of "Uploaded,
         * but not confirmed" rows, one per confirm that Safari shed while the
         * uplink was saturated with photo bodies (Mason: "They keep coming up
         * here and there... it will feel broken if this is a regular thing
         * for users"). finalizeUpload's own retries span ~3s — inside the
         * burst, as always. So the confirm alone rides the queue again,
         * flagged finalizeOnly so no bytes are ever re-sent for it.
         */
        if ((task.requeues ?? 0) < MAX_REQUEUES) {
          updateFile(task.batchId, task.fileId, {
            status: "uploading",
            progress: 100,
          });
          const q = queues.current.get(task.batchId);
          if (q && !aborted.current.has(task.batchId)) {
            q.push({
              ...task,
              requeues: (task.requeues ?? 0) + 1,
              finalizeOnly: true,
            });
            return;
          }
        }
        const list = failedFiles.current.get(task.batchId) ?? [];
        list.push(task.file);
        failedFiles.current.set(task.batchId, list);
        updateFile(task.batchId, task.fileId, {
          status: "error",
          error: "Uploaded, but not confirmed — retry",
          imageId: task.imageId,
          finalizeNeeded: true,
        });
        return;
      }

      updateFile(task.batchId, task.fileId, {
        status: "complete",
        progress: 100,
        imageId: task.imageId,
      });
      const done = completedIds.current.get(task.batchId) ?? [];
      done.push(task.imageId);
      completedIds.current.set(task.batchId, done);
      if (eventId) emit({ type: "image-uploaded", eventId });
    },
    [cancelTask, deleteOrphanRow, finalizeUpload, updateFile, emit]
  );

  /**
   * Pull the next task, rotating across batches. A single FIFO queue would let
   * a 3,000-file dump hold every worker until it finished, so a 40-file batch
   * dropped a minute later would not move at all.
   */
  const nextTask = useCallback((): UploadTask | undefined => {
    const ids = [...queues.current.keys()].filter(
      (id) => (queues.current.get(id)?.length ?? 0) > 0
    );
    if (ids.length === 0) return undefined;
    rrCursor.current = (rrCursor.current + 1) % ids.length;
    const id = ids[rrCursor.current];
    return queues.current.get(id)!.shift();
  }, []);

  const drainQueue = useCallback(() => {
    while (activeWorkers.current < MAX_CONCURRENT_UPLOADS) {
      const task = nextTask();
      if (!task) break;
      activeWorkers.current++;
      uploadOne(task)
        .catch(() => {})
        .finally(() => {
          activeWorkers.current--;
          drainQueue();
        });
    }
  }, [nextTask, uploadOne]);

  const uploadEntries = useCallback(
    async (batchId: string, entries: UploadFile[]) => {
      const batch = batchesRef.current.find((b) => b.id === batchId);
      if (!batch) return;
      const { eventId, sectionId } = batch;

      /**
       * DROP-TIME READABILITY PROBE — a 1-byte test read per file, before any
       * row is minted or any byte is queued.
       *
       * A dropped file can be a promise with nothing behind it: Dropbox's
       * "save hard drive space automatically" de-materializes local files on
       * its own schedule, and its sync touches invalidate the browser's
       * dropped-file handles — so files that were green-badged at drag time
       * turn unreadable mid-queue, scattered across folders ("this is
       * happening in both sections" — Mason, 2026-08-16). Discovering that
       * three spread-out passes later wasted minutes per file and read as the
       * uploader failing. A local file answers this probe in microseconds; a
       * dead handle fails it instantly. Flagged rows never enter the queue,
       * so no orphan row is ever minted for them.
       *
       * A passing probe is NOT a guarantee — eviction can still happen between
       * probe and upload — which is why the snapshot read keeps its own
       * requeue. This probe just moves the COMMON case of "already evicted"
       * from minutes-later to immediately.
       */
      const PROBE_CONCURRENCY = 8;
      const readable: UploadFile[] = [];
      let cursor = 0;
      await Promise.all(
        Array.from({ length: PROBE_CONCURRENCY }, async () => {
          while (cursor < entries.length) {
            const e = entries[cursor++];
            try {
              await e.file.slice(0, 1).arrayBuffer();
              readable.push(e);
            } catch {
              const list = failedFiles.current.get(batchId) ?? [];
              list.push(e.file);
              failedFiles.current.set(batchId, list);
              updateFile(batchId, e.id, {
                status: "error",
                error:
                  "Not readable on this Mac — it's likely online-only in Dropbox/iCloud. Download it, then drop it again",
              });
            }
          }
        })
      );
      // Keep the original drop order — concurrent probing interleaves it, and
      // a lexical sort on ids would put "-10" before "-2".
      const okIds = new Set(readable.map((e) => e.id));
      entries = entries.filter((e) => okIds.has(e.id));
      if (entries.length === 0) return;
      // Files the archive already held, skipped at presign. Reported once at
      // the end — a silent skip is indistinguishable from a lost upload, which
      // is the anxiety this whole area keeps generating.
      let duplicatesSkipped = 0;
      // Existing photos added to this section rather than skipped. Distinct
      // from a duplicate: something DID happen, and the photographer should be
      // told what, or the batch looks like it silently lost files.
      let linkedToSection = 0;

      for (let start = 0; start < entries.length; start += PRESIGN_CHUNK) {
        if (aborted.current.has(batchId)) break;

        // Bound how much can be lost if the tab dies. Per BATCH, not global: a
        // global mark would let one batch sit at the ceiling and block another
        // batch's presign loop forever.
        await waitForQueueRoom(
          () => queues.current.get(batchId)?.length ?? 0,
          () => aborted.current.has(batchId)
        );
        if (aborted.current.has(batchId)) break;

        // NOTE: there is deliberately no parallel `files` array here. There used
        // to be (`const chunk = chunkEntries.map(e => e.file)`), and when the
        // duplicate/linked filters below started REASSIGNING chunkEntries, that
        // copy silently kept the unfiltered order — so the row minted for file N
        // received file N-1's bytes. 805 of 1,142 photos in a live client
        // gallery ended up filed under the wrong person's name. Read the file
        // off the entry you are actually looking at, never off a snapshot of it.
        let chunkEntries = entries.slice(start, start + PRESIGN_CHUNK);

        let uploads:
          | Array<{ imageId: string; uploadUrl: string; originalFilename?: string }>
          | undefined;
        try {
          /**
           * The presign POST RETRIES on network failure, because its blast
           * radius is the whole chunk: this one request stands in for up to 50
           * files, and it used to fail them all on a single browser-level
           * "Load failed" — which is exactly what a fetch gets when it loses a
           * scheduling fight with 12 concurrent upload bodies. Mason watched
           * failures jump 12 → 24 → 48 in blocks of a chunk (Safari,
           * 2026-08-16); every block was one lost request.
           *
           * Only thrown fetches (network layer) retry. An HTTP error response
           * is the server's ANSWER and stays terminal — re-asking a question
           * the server already answered is how you mint duplicate rows.
           */
          let response: Response | undefined;
          let lastNetErr: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            if (aborted.current.has(batchId)) break;
            try {
              response = await fetch("/api/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  eventId,
                  sectionId: sectionId || undefined,
                  files: chunkEntries.map((e) => ({
                    name: e.file.name,
                    type: e.file.type,
                    size: e.file.size,
                  })),
                }),
              });
              break;
            } catch (err) {
              lastNetErr = err;
              await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
            }
          }
          if (!response) throw lastNetErr ?? new Error("Network error");
          if (!response.ok) {
            for (const e of chunkEntries) {
              const list = failedFiles.current.get(batchId) ?? [];
              list.push(e.file);
              failedFiles.current.set(batchId, list);
              updateFile(batchId, e.id, {
                status: "error",
                error: `Server error (${response.status})`,
              });
            }
            continue;
          }
          const presign = await response.json();
          uploads = presign.uploads;
          // Files the server already holds (same name AND size, settled). They
          // are NOT failures and NOT re-uploaded — mark them done so the ring
          // closes honestly, and drop them before the length check below,
          // which would otherwise read a short uploads array as errors.
          // Already in the event but not in this section — the server linked
          // them here rather than dropping them. Same terminal state for the
          // ring (nothing to upload), different meaning, so they are counted
          // and reported apart from true duplicates.
          const linkKeys = new Set<string>(presign.linkedKeys ?? []);
          if (linkKeys.size > 0) {
            const linked = chunkEntries.filter((e) =>
              linkKeys.has(`${e.file.name}|${e.file.size}`)
            );
            for (const e of linked) {
              updateFile(batchId, e.id, { status: "linked" });
            }
            linkedToSection += linked.length;
            chunkEntries = chunkEntries.filter(
              (e) => !linkKeys.has(`${e.file.name}|${e.file.size}`)
            );
            if (chunkEntries.length === 0) continue;
          }

          const dupKeys = new Set<string>(presign.duplicateKeys ?? []);
          if (dupKeys.size > 0) {
            const skipped = chunkEntries.filter((e) =>
              dupKeys.has(`${e.file.name}|${e.file.size}`)
            );
            // The UI already has a "duplicate" state (from the per-section
            // filename pre-check). This is the authoritative version of that
            // check — name AND size, whole event, server-side, unskippable.
            const dupIds = (presign.duplicateImageIds ?? {}) as Record<
              string,
              string
            >;
            for (const e of skipped) {
              // Carry the existing image id through, or "Replace all" has
              // nothing to delete: it would re-upload, the server would skip it
              // as a duplicate again, and the button would silently do nothing.
              const existingId = dupIds[`${e.file.name}|${e.file.size}`];
              updateFile(batchId, e.id, {
                status: "duplicate",
                ...(existingId ? { existingImageIds: [existingId] } : {}),
              });
            }
            duplicatesSkipped += skipped.length;
            chunkEntries = chunkEntries.filter(
              (e) => !dupKeys.has(`${e.file.name}|${e.file.size}`)
            );
            if (chunkEntries.length === 0) continue;
          }
        } catch (err) {
          for (const e of chunkEntries) {
            const list = failedFiles.current.get(batchId) ?? [];
            list.push(e.file);
            failedFiles.current.set(batchId, list);
            updateFile(batchId, e.id, {
              status: "error",
              error: err instanceof Error ? err.message : "Network error",
            });
          }
          continue;
        }

        if (!Array.isArray(uploads) || uploads.length < chunkEntries.length) {
          for (let i = uploads?.length ?? 0; i < chunkEntries.length; i++) {
            const list = failedFiles.current.get(batchId) ?? [];
            list.push(chunkEntries[i].file);
            failedFiles.current.set(batchId, list);
            updateFile(batchId, chunkEntries[i].id, {
              status: "error",
              error: "Server returned no upload URL",
            });
          }
        }

        const q = queues.current.get(batchId) ?? [];
        (uploads ?? []).forEach((u, i) => {
          const entry = chunkEntries[i];
          if (!entry) return;
          // The row and the bytes must be the same file. The server tells us
          // which filename it minted this row for, so ASSERT it rather than
          // trusting two lists to have stayed in the same order — that trust is
          // exactly what silently mislabelled a whole gallery. A mismatch here
          // is a bug, so fail the file loudly instead of uploading the wrong
          // photo under someone else's name.
          if (u.originalFilename && u.originalFilename !== entry.file.name) {
            const list = failedFiles.current.get(batchId) ?? [];
            list.push(entry.file);
            failedFiles.current.set(batchId, list);
            updateFile(batchId, entry.id, {
              status: "error",
              error: "Upload slot mismatch — not sent (please retry)",
            });
            return;
          }
          q.push({
            batchId,
            fileId: entry.id,
            file: entry.file,
            imageId: u.imageId,
            uploadUrl: u.uploadUrl,
          });
        });
        queues.current.set(batchId, q);
        drainQueue();
      }
    },
    [drainQueue, updateFile]
  );

  const startBatch = useCallback(
    async ({
      eventId,
      eventName = null,
      sectionId,
      sectionName,
      files,
    }: {
      eventId: string;
      eventName?: string | null;
      sectionId: string | null;
      sectionName: string | null;
      files: File[];
    }) => {
      if (files.length === 0) return;
      const batchId = `${eventId}-${sectionId ?? "intake"}-${performance.now()}`;
      /**
       * NO eager object URLs. This used to `URL.createObjectURL(file)` for
       * every file at drop time — 671 files meant 671 live file references
       * held by one Safari page, which blows the browser's per-page resource
       * budget. Past it, EVERY file open fails: previews go blank across the
       * board, and the upload-time reads start failing on files that are
       * verifiably local ("the files are all downloaded and synced" — Mason,
       * 2026-08-16, correctly killing the cloud-placeholder theory as the
       * whole story). The list renders at most ~30 rows; FilePreview now
       * mints its own URL on mount and revokes on unmount, so at most ~30
       * are ever live regardless of drop size.
       */
      const entries: UploadFile[] = files.map((file, i) => ({
        id: `${batchId}-${i}`,
        file,
        previewUrl: "",
        status: "pending" as FileStatus,
        progress: 0,
      }));

      aborted.current.delete(batchId);
      queues.current.set(batchId, []);
      setBatches((prev) => [
        ...prev,
        {
          id: batchId,
          eventId,
          eventName,
          sectionId,
          sectionName,
          files: entries,
          createdAt: Date.now(),
        },
      ]);

      // Duplicate pre-check (same filename in the SAME section). Only complete
      // rows count server-side — a pending row is a reservation, not a photo.
      let dupMap: Record<string, string[]> = {};
      if (sectionId) {
        try {
          const res = await fetch(`/api/sections/${sectionId}/check-duplicates`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filenames: [...new Set(files.map((f) => f.name))],
            }),
          });
          if (res.ok) dupMap = (await res.json()).duplicates ?? {};
        } catch {
          /* better to allow than to block on a flaky check */
        }
      }

      const toUpload: UploadFile[] = [];
      for (const entry of entries) {
        const existing = dupMap[entry.file.name];
        if (existing && existing.length > 0) {
          updateFile(batchId, entry.id, {
            status: "duplicate",
            existingImageIds: existing,
          });
        } else {
          toUpload.push(entry);
        }
      }

      await uploadEntries(batchId, toUpload);
    },
    [updateFile, uploadEntries]
  );

  const cancelBatch = useCallback(
    (batchId: string) => {
      // Apply anything still in flight before reading statuses below: this
      // drops files whose status is "pending", and a file that started
      // uploading within the last flush window would otherwise still read
      // pending and be removed out from under its own worker.
      flushPatches();
      aborted.current.add(batchId);
      const queued = queues.current.get(batchId) ?? [];
      queues.current.set(batchId, []);
      const dropIds = new Set(queued.map((t) => t.fileId));
      setBatches((prev) =>
        prev.map((b) => {
          if (b.id !== batchId) return b;
          b.files.forEach((f) => {
            if ((dropIds.has(f.id) || f.status === "pending") && f.previewUrl) {
              URL.revokeObjectURL(f.previewUrl);
              objectUrls.current.delete(f.previewUrl);
            }
          });
          return {
            ...b,
            files: b.files.filter(
              (f) => !dropIds.has(f.id) && f.status !== "pending"
            ),
          };
        })
      );
      // Cancel runs with the page alive — no keepalive, no byte budget.
      deleteRowsInBatches(queued.map((t) => t.imageId), false);
    },
    [flushPatches]
  );

  const retryFinalize = useCallback(
    async (batchId: string, entry: UploadFile) => {
      if (!entry.imageId) return;
      const batch = batchesRef.current.find((b) => b.id === batchId);
      updateFile(batchId, entry.id, {
        status: "uploading",
        progress: 100,
        error: undefined,
      });
      const finalized = await finalizeUpload(entry.imageId, entry.file);
      if (finalized) {
        updateFile(batchId, entry.id, { status: "complete", finalizeNeeded: false });
        const done = completedIds.current.get(batchId) ?? [];
        done.push(entry.imageId);
        completedIds.current.set(batchId, done);
        if (batch) emit({ type: "image-uploaded", eventId: batch.eventId });
      } else {
        updateFile(batchId, entry.id, {
          status: "error",
          error: "Uploaded, but not confirmed — retry",
        });
      }
    },
    [updateFile, finalizeUpload, emit]
  );

  // ─── Live throughput (all batches share one uplink, so one readout) ───
  const anyActive = batches.some((b) =>
    b.files.some((f) => f.status === "pending" || f.status === "uploading")
  );
  useEffect(() => {
    if (!anyActive) {
      setSpeedMbps(null);
      return;
    }
    let prevBytes = bytesSentRef.current;
    let ema: number | null = null;
    const id = setInterval(() => {
      const now = bytesSentRef.current;
      const inst = ((now - prevBytes) * 8) / 1e6;
      prevBytes = now;
      ema = ema === null ? inst : ema * 0.7 + inst * 0.3;
      setSpeedMbps(ema);
    }, 1000);
    return () => clearInterval(id);
  }, [anyActive]);

  // ─── Batch lifecycle: fire completion events, then retire drained batches ───
  const settledRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const b of batches) {
      const active = b.files.some(
        (f) => f.status === "pending" || f.status === "uploading"
      );
      if (active) {
        settledRef.current.delete(b.id);
        continue;
      }
      if (settledRef.current.has(b.id)) continue;
      settledRef.current.add(b.id);

      const failed = failedFiles.current.get(b.id) ?? [];
      if (failed.length) {
        failedFiles.current.set(b.id, []);
        emit({ type: "batch-failed", eventId: b.eventId, files: failed });
      }
      const done = completedIds.current.get(b.id) ?? [];
      if (done.length) {
        completedIds.current.set(b.id, []);
        emit({ type: "batch-complete", eventId: b.eventId, imageIds: done });
      }
    }
  }, [batches, emit]);

  // Retire a batch once nothing is left needing attention (errors and held
  // duplicates keep it alive so they stay actionable).
  //
  // Keyed on the retirable ID SET, not `batches`: the array gets a new
  // identity on every XHR progress tick (12 workers × per-percent updates),
  // and depending on it reset this timer many times a second — a drained
  // batch could not leave while ANY other upload was still moving, which is
  // how a finished 42-file batch stayed in the event totals for the whole of
  // the next 481-file upload (Justin's 523, 2026-08-10).
  const retirableKey = batches
    .filter(
      (b) => b.files.length > 0 && b.files.every((f) => f.status === "complete")
    )
    .map((b) => b.id)
    .sort()
    .join(",");
  useEffect(() => {
    if (!retirableKey) return;
    const retireIds = new Set(retirableKey.split(","));
    const t = setTimeout(() => {
      setBatches((prev) =>
        prev.filter((b) => {
          if (!retireIds.has(b.id)) return true;
          // Still fully complete? (A re-drop into the same batch id can't
          // happen — ids are unique per drop — but stay defensive.)
          if (!b.files.every((f) => f.status === "complete")) return true;
          b.files.forEach((f) => {
            if (f.previewUrl) {
              URL.revokeObjectURL(f.previewUrl);
              objectUrls.current.delete(f.previewUrl);
            }
          });
          queues.current.delete(b.id);
          return false;
        })
      );
    }, 600);
    return () => clearTimeout(t);
  }, [retirableKey]);

  // ─── Unfinished manifest, per event ───
  // Mirrors what a session hasn't finished so a crash leaves a record. The
  // server route is authoritative; this catches files that died before their
  // presign call ever created a row.
  useEffect(() => {
    if (!anyActive) return;
    const write = () => {
      const byEvent = new Map<string, string[]>();
      for (const b of batchesRef.current) {
        for (const f of b.files) {
          if (f.status === "pending" || f.status === "uploading") {
            const list = byEvent.get(b.eventId) ?? [];
            list.push(f.file.name);
            byEvent.set(b.eventId, list);
          }
        }
      }
      const seen = new Set<string>();
      for (const [eventId, names] of byEvent) {
        seen.add(eventId);
        try {
          localStorage.setItem(
            unfinishedKey(eventId),
            JSON.stringify({ savedAt: Date.now(), files: names })
          );
        } catch {
          /* quota or private mode — the reconciler still backstops the rows */
        }
      }
      for (const b of batchesRef.current) {
        if (!seen.has(b.eventId)) {
          try {
            localStorage.removeItem(unfinishedKey(b.eventId));
          } catch {
            /* nothing to clean up */
          }
        }
      }
    };
    const id = setInterval(write, UNFINISHED_SAVE_MS);
    return () => {
      clearInterval(id);
      write();
    };
  }, [anyActive]);

  // ─── Leaving the tab: warn, and clean what provably can't finish ───
  // Now global. In-app navigation no longer touches uploads at all — only a
  // real unload can end them, because no browser uploads from a dead tab.
  useEffect(() => {
    if (!anyActive) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onPageHide = () => {
      const ids: string[] = [];
      for (const [batchId, q] of queues.current) {
        ids.push(...q.map((t) => t.imageId));
        queues.current.set(batchId, []);
      }
      deleteRowsInBatches(ids, true);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [anyActive]);

  const value = useMemo<UploadManagerValue>(
    () => ({
      batches,
      speedMbps,
      corsError,
      startBatch,
      cancelBatch,
      updateFile,
      removeFiles,
      uploadEntries,
      retryFinalize,
      subscribe,
    }),
    [
      batches,
      speedMbps,
      corsError,
      startBatch,
      cancelBatch,
      updateFile,
      removeFiles,
      uploadEntries,
      retryFinalize,
      subscribe,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
