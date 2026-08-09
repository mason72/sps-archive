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
const MAX_CONCURRENT_UPLOADS = 12;
const R2_PUT_RETRIES = 2;
const R2_RETRY_BASE_MS = 1000;
const R2_PUT_TIMEOUT_MS = 120_000;
const MIN_UPLOAD_BYTES_PER_SEC = 250 * 1024;
const PROXY_MAX_BYTES = 4 * 1024 * 1024;
const CORS_FAILURE_THRESHOLD = 3;
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
  | "duplicate";

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
}

export type UploadEvent =
  | { type: "image-uploaded"; eventId: string }
  | { type: "batch-complete"; eventId: string; imageIds: string[] }
  | { type: "batch-failed"; eventId: string; files: File[] };

/** PUT with real progress events (fetch exposes none). */
function putWithProgress(
  url: string,
  file: File,
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

/** Aggregate progress for one event — what the page's unified bar reads. */
export function useEventUploadProgress(eventId: string) {
  const { batches } = useUploadManager();
  return useMemo(() => {
    const mine = batches.filter((b) => b.eventId === eventId);
    const files = mine.flatMap((b) => b.files);
    const counted = files.filter((f) => f.status !== "duplicate");
    const inFlight = files.filter(
      (f) => f.status === "pending" || f.status === "uploading"
    ).length;
    return {
      active: inFlight > 0,
      total: counted.length,
      uploaded: files.filter((f) => f.status === "complete").length,
      failed: files.filter((f) => f.status === "error").length,
      inFlight,
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
  const corsBlockedRef = useRef(false);
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

  const updateFile = useCallback(
    (batchId: string, fileId: string, patch: Partial<UploadFile>) => {
      setBatches((prev) =>
        prev.map((b) =>
          b.id !== batchId
            ? b
            : {
                ...b,
                files: b.files.map((f) => (f.id === fileId ? { ...f, ...patch } : f)),
              }
        )
      );
    },
    []
  );

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

      if (!useProxy && corsBlockedRef.current) {
        (failedFiles.current.get(task.batchId) ?? []).push(task.file);
        await deleteOrphanRow(task.imageId);
        updateFile(task.batchId, task.fileId, {
          status: "error",
          error: "Files over 4 MB need storage (CORS) configured — see settings",
        });
        return;
      }

      updateFile(task.batchId, task.fileId, { status: "uploading", progress: 0 });
      const target = useProxy ? `/api/upload/${task.imageId}` : task.uploadUrl;

      let ok = false;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= R2_PUT_RETRIES; attempt++) {
        if (isAborted()) return cancelTask(task);
        try {
          let lastPct = -1;
          let lastLoaded = 0;
          const res = await putWithProgress(target, task.file, {
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
        } catch (err) {
          lastErr = err;
          if (!useProxy && err instanceof TypeError) {
            corsFailureCount.current++;
            if (corsFailureCount.current >= CORS_FAILURE_THRESHOLD) {
              corsBlockedRef.current = true;
              setCorsError(true);
              break;
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
        const list = failedFiles.current.get(task.batchId) ?? [];
        list.push(task.file);
        failedFiles.current.set(task.batchId, list);
        // Clean up the pre-created row so a failed upload never leaves a ghost.
        // (This is also the diagnostic that tells a failed upload from one that
        // was never attempted: a surviving "pending" row means never tried.)
        await deleteOrphanRow(task.imageId);
        updateFile(task.batchId, task.fileId, {
          status: "error",
          error:
            !useProxy && (lastErr instanceof TypeError || corsBlockedRef.current)
              ? "Files over 4 MB need storage (CORS) configured — see settings"
              : lastErr instanceof Error
              ? lastErr.message
              : "Upload failed",
        });
        return;
      }

      corsFailureCount.current = 0;

      const finalized = await finalizeUpload(task.imageId, task.file);
      if (!finalized) {
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

        const chunkEntries = entries.slice(start, start + PRESIGN_CHUNK);
        const chunk = chunkEntries.map((e) => e.file);

        let uploads: Array<{ imageId: string; uploadUrl: string }> | undefined;
        try {
          const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId,
              sectionId: sectionId || undefined,
              files: chunk.map((f) => ({
                name: f.name,
                type: f.type,
                size: f.size,
              })),
            }),
          });
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
          uploads = (await response.json()).uploads;
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
          if (!chunkEntries[i]) return;
          q.push({
            batchId,
            fileId: chunkEntries[i].id,
            file: chunk[i],
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
      const entries: UploadFile[] = files.map((file, i) => {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.add(previewUrl);
        return {
          id: `${batchId}-${i}`,
          file,
          previewUrl,
          status: "pending" as FileStatus,
          progress: 0,
        };
      });

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
    []
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
  useEffect(() => {
    const retirable = batches.filter(
      (b) =>
        b.files.length > 0 &&
        b.files.every((f) => f.status === "complete")
    );
    if (retirable.length === 0) return;
    const t = setTimeout(() => {
      setBatches((prev) =>
        prev.filter((b) => {
          const retire = retirable.some((r) => r.id === b.id);
          if (retire) {
            b.files.forEach((f) => {
              if (f.previewUrl) {
                URL.revokeObjectURL(f.previewUrl);
                objectUrls.current.delete(f.previewUrl);
              }
            });
            queues.current.delete(b.id);
          }
          return !retire;
        })
      );
    }, 600);
    return () => clearTimeout(t);
  }, [batches]);

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
