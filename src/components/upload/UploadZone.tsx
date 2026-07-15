"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  Upload,
  Loader2,
  RotateCcw,
  ShieldAlert,
  Copy,
  Film,
} from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";
import { extractExif } from "@/lib/upload/parse-filename";
import {
  UPLOAD_ACCEPT,
  isVideoMime,
  validateUploadFile,
} from "@/lib/upload/media";

const PRESIGN_CHUNK = 50; // how many files we request presigned URLs for at once
const MAX_CONCURRENT_UPLOADS = 12;
const R2_PUT_RETRIES = 2;
const R2_RETRY_BASE_MS = 1000;
/** Hard ceiling on a single upload so a hung connection can't spin forever. */
const R2_PUT_TIMEOUT_MS = 120_000;
/**
 * Large videos need more than the 2-minute ceiling: scale the timeout so any
 * connection managing at least ~250 KB/s never gets cut off mid-upload (a
 * 500 MB reel gets ~34 min). Images keep the original ceiling.
 */
const MIN_UPLOAD_BYTES_PER_SEC = 250 * 1024;
function uploadTimeoutMs(fileSize: number): number {
  return Math.max(
    R2_PUT_TIMEOUT_MS,
    Math.round((fileSize / MIN_UPLOAD_BYTES_PER_SEC) * 1000)
  );
}
/**
 * Files at or below this size upload through our server proxy
 * (PUT /api/upload/[imageId]), which needs no R2 CORS and always works.
 * Larger files go browser→R2 directly to bypass Vercel's ~4.5MB request body
 * limit (that path needs the R2 bucket's CORS policy configured).
 */
const PROXY_MAX_BYTES = 4 * 1024 * 1024;

/**
 * CORS failures from direct-to-R2 uploads manifest as TypeError("Failed to
 * fetch") with no response body. After this many consecutive TypeErrors on
 * direct R2 PUTs, we surface a CORS configuration error.
 */
const CORS_FAILURE_THRESHOLD = 3;

/**
 * Cap on how many file rows are RENDERED at once. Every rendered row mounts an
 * <img> whose object URL makes the browser decode the ORIGINAL file — a 24 MP
 * JPEG decodes to ~100 MB of bitmap, so a 2000-file drop rendered in full
 * killed the tab before a single byte reached the server (Appfolio, Jul 2026).
 * Workers drain the queue in drop order, so the capped window always shows the
 * rows that are actually moving; a footer counts the rest.
 */
const MAX_RENDERED_ROWS = 30;

/**
 * EXIF lives in the file header (JPEG APP1 sits right after SOI), so only this
 * much of each file is read for extraction. Reading whole files held up to
 * 12 × 100 MB in memory at peak concurrency.
 */
const EXIF_SCAN_BYTES = 4 * 1024 * 1024;

type FileStatus = "pending" | "uploading" | "complete" | "error" | "duplicate";

interface UploadFile {
  id: string;
  file: File;
  previewUrl: string;
  status: FileStatus;
  /** 0–100, real bytes-sent progress for the current upload. */
  progress: number;
  error?: string;
  imageId?: string;
  /** When status is "duplicate": the existing image ids in this section that
   *  share this filename (deleted if the user chooses Replace). */
  existingImageIds?: string[];
  /** Error state where the BINARY is safely in R2 but /api/upload/complete
   *  never succeeded — retry re-finalizes instead of re-uploading. */
  finalizeNeeded?: boolean;
}

/**
 * PUT a file via XMLHttpRequest so we get real upload-progress events
 * (fetch() exposes none). Resolves with the HTTP status; rejects on network
 * error/timeout/abort. onProgress receives 0–100.
 */
function putWithProgress(
  url: string,
  file: File,
  opts: {
    timeoutMs: number;
    signal: { aborted: boolean };
    onProgress: (pct: number) => void;
  }
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.timeout = opts.timeoutMs;
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        opts.onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      opts.onProgress(100);
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    };
    xhr.onerror = () => reject(new TypeError("Failed to fetch"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    xhr.onabort = () => reject(new Error("aborted"));

    // Cooperative abort: poll the shared abort flag and cancel in flight.
    const abortPoll = setInterval(() => {
      if (opts.signal.aborted) {
        clearInterval(abortPoll);
        xhr.abort();
      }
    }, 250);
    const clear = () => clearInterval(abortPoll);
    xhr.addEventListener("loadend", clear);

    xhr.send(file);
  });
}

/**
 * List-row preview. Object URLs render in an <img> for images only; videos
 * (and rejected files with no preview) get a film placeholder instead.
 */
function FilePreview({ file, previewUrl }: { file: File; previewUrl: string }) {
  if (!previewUrl || isVideoMime(file.type)) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-stone-200">
        <Film className="h-4 w-4 text-stone-400" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={previewUrl}
      alt={file.name}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  );
}

export interface UploadProgress {
  active: boolean;
  total: number;
  uploaded: number;
  failed: number;
  inFlight: number;
}

interface UploadZoneProps {
  eventId: string;
  sectionId?: string | null;
  sectionName?: string | null;
  onUploadComplete?: (imageIds: string[]) => void;
  onUploadFailed?: (files: File[]) => void;
  /** Fires whenever an individual image lands, so the grid can populate live. */
  onImageUploaded?: (imageId: string) => void;
  /** Live progress for a single unified bar owned by the page. */
  onProgressChange?: (p: UploadProgress) => void;
  retryFiles?: File[];
}

/**
 * UploadZone — drag/drop uploader.
 *
 * Design principles (uploading is the most important action):
 *  - New files dropped mid-upload MERGE into the running session immediately:
 *    they're added to state, queued, and the total updates at once.
 *  - A shared worker pool pulls from a single queue, so there are no
 *    sequential "batches" that stall the count at 50.
 *  - The list shows only what still needs attention: a finished upload FALLS
 *    OFF the list (its thumbnail appears in the grid below instead). Errors
 *    stay so they can be retried. An empty list therefore means "all done" —
 *    and the whole block disappears, leaving a clean page.
 */
export function UploadZone({
  eventId,
  sectionId,
  sectionName,
  onUploadComplete,
  onUploadFailed,
  onImageUploaded,
  onProgressChange,
  retryFiles,
}: UploadZoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [corsError, setCorsError] = useState(false);
  // True while the end-of-session server check runs — holds the auto-clear
  // so a row the server disputes can be flipped back to an error in place.
  const [reconciling, setReconciling] = useState(false);

  const abortRef = useRef(false);
  const corsFailureCount = useRef(0);
  // Set once the DIRECT (>4MB) path has clearly hit a CORS wall. It short-
  // circuits further LARGE-file attempts only — small files keep uploading
  // through the proxy. (Previously a CORS storm tripped the global abort and
  // stranded the whole batch, including small files that would've worked.)
  const corsBlockedRef = useRef(false);
  // Capture sectionId at drop time so it doesn't go stale mid-upload.
  const sectionIdRef = useRef(sectionId);
  sectionIdRef.current = sectionId;

  // ─── Shared work queue + worker pool ───
  // Tasks are pushed here as presigned URLs come back. Workers pull from it,
  // so files dropped mid-upload are picked up by idle workers immediately.
  const queueRef = useRef<UploadTask[]>([]);
  const activeWorkers = useRef(0);
  const completedIdsRef = useRef<string[]>([]);
  const failedFilesRef = useRef<File[]>([]);
  // Object URLs to revoke on unmount.
  const objectUrls = useRef<Set<string>>(new Set());

  interface UploadTask {
    fileId: string;
    file: File;
    imageId: string;
    uploadUrl: string;
  }

  const updateFile = useCallback(
    (id: string, update: Partial<UploadFile>) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...update } : f)));
    },
    []
  );

  const removeFiles = useCallback((ids: Set<string>) => {
    setFiles((prev) => {
      prev.forEach((f) => {
        if (ids.has(f.id)) {
          URL.revokeObjectURL(f.previewUrl);
          objectUrls.current.delete(f.previewUrl);
        }
      });
      return prev.filter((f) => !ids.has(f.id));
    });
  }, []);

  // Delete the DB row pre-created by /api/upload for a file that then failed to
  // upload, so a failed upload never leaves a backing-less "ghost" image.
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

  // Finalize an upload whose binary is in R2: extract EXIF (best-effort) and
  // POST /api/upload/complete until it sticks. Returns true only on a
  // server-confirmed 2xx — the caller must NOT mark the file complete
  // otherwise (claiming success on an unconfirmed finalize left 458 images
  // stuck "pending" in the eBay HEADSHOTS incident).
  const finalizeUpload = useCallback(
    async (imageId: string, file: File): Promise<boolean> => {
      let exifData: Record<string, unknown> = {};
      if (!isVideoMime(file.type)) {
        try {
          const buf = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
          const exif = await extractExif(buf);
          if (exif) exifData = exif;
        } catch {
          // EXIF is non-critical
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
          // retry
        }
        if (attempt < COMPLETE_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
      return false;
    },
    []
  );

  // A task abandoned mid-session (Cancel, navigation) must not leave its
  // pre-created DB row behind as a ghost tile.
  const cancelTask = useCallback(
    async (task: UploadTask) => {
      removeFiles(new Set([task.fileId]));
      await deleteOrphanRow(task.imageId);
    },
    [removeFiles, deleteOrphanRow]
  );

  // ─── Upload a single task (proxy for small files, direct for large) ───
  const uploadOne = useCallback(
    async (task: UploadTask) => {
      if (abortRef.current) {
        await cancelTask(task);
        return;
      }

      const useProxy = task.file.size <= PROXY_MAX_BYTES;

      // Large files can only go direct-to-R2, which needs bucket CORS. If that
      // path is already known-blocked, fail this file fast with a clear reason
      // — but DON'T touch the queue, so small files keep flowing.
      if (!useProxy && corsBlockedRef.current) {
        failedFilesRef.current.push(task.file);
        await deleteOrphanRow(task.imageId);
        updateFile(task.fileId, {
          status: "error",
          error: "Files over 4 MB need storage (CORS) configured — see settings",
        });
        return;
      }

      updateFile(task.fileId, { status: "uploading", progress: 0 });
      const target = useProxy ? `/api/upload/${task.imageId}` : task.uploadUrl;

      let ok = false;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= R2_PUT_RETRIES; attempt++) {
        if (abortRef.current) {
          await cancelTask(task);
          return;
        }
        try {
          // Progress events fire far more often than the integer pct changes;
          // only distinct values hit React state (a 2000-file session otherwise
          // re-renders the list thousands of times per second).
          let lastPct = -1;
          const res = await putWithProgress(target, task.file, {
            timeoutMs: uploadTimeoutMs(task.file.size),
            signal: { get aborted() { return abortRef.current; } },
            onProgress: (pct) => {
              if (pct === lastPct) return;
              lastPct = pct;
              updateFile(task.fileId, { progress: pct });
            },
          });
          if (res.ok) {
            ok = true;
            break;
          }
          lastErr = new Error(`Upload failed (${res.status})`);
        } catch (err) {
          lastErr = err;
          // TypeError on the DIRECT path = CORS wall. Flag it so subsequent
          // large files fail fast (above) — but never abort the small-file
          // (proxy) work, which doesn't depend on CORS.
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
          // Reset the bar before retrying so it doesn't look stuck mid-fill.
          updateFile(task.fileId, { progress: 0 });
          await new Promise((r) =>
            setTimeout(r, R2_RETRY_BASE_MS * Math.pow(2, attempt))
          );
        }
      }

      if (!ok) {
        // A batch canceled mid-flight is cleanup, not an error.
        if (abortRef.current) {
          await cancelTask(task);
          return;
        }
        failedFilesRef.current.push(task.file);
        // Clean up the pre-created DB row so a failed upload never leaves a
        // backing-less "ghost" image (the cause of broken tiles).
        await deleteOrphanRow(task.imageId);
        updateFile(task.fileId, {
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

      // Tell the server we're done. If finalize can't be CONFIRMED, the file
      // is an error the user can see and retry — never a silent "complete".
      // (The binary is safe in R2, so retry only re-finalizes.)
      const finalized = await finalizeUpload(task.imageId, task.file);
      if (!finalized) {
        failedFilesRef.current.push(task.file);
        updateFile(task.fileId, {
          status: "error",
          error: "Uploaded, but not confirmed — retry",
          imageId: task.imageId,
          finalizeNeeded: true,
        });
        return;
      }

      // Mark complete — the binary is in R2 and the server confirmed the row.
      // The grid can show it now, and the row falls off the upload list (it's
      // filtered out of the displayed list below).
      updateFile(task.fileId, { status: "complete", progress: 100, imageId: task.imageId });
      completedIdsRef.current.push(task.imageId);
      onImageUploaded?.(task.imageId);
    },
    [updateFile, onImageUploaded, deleteOrphanRow, finalizeUpload, cancelTask]
  );

  // ─── Worker pool: pulls from the shared queue until it's drained ───
  const drainQueue = useCallback(() => {
    while (
      activeWorkers.current < MAX_CONCURRENT_UPLOADS &&
      queueRef.current.length > 0
    ) {
      const task = queueRef.current.shift()!;
      activeWorkers.current++;
      uploadOne(task)
        .catch(() => {
          /* uploadOne never throws, but guard anyway */
        })
        .finally(() => {
          activeWorkers.current--;
          // Pick up any work that arrived while we were busy.
          drainQueue();
        });
    }
  }, [uploadOne]);

  // ─── Presign + enqueue a set of already-registered entries ───
  // (Shared by the normal drop path and the "Replace"/"upload anyway" paths.)
  const uploadEntries = useCallback(
    async (entries: UploadFile[]) => {
      for (let start = 0; start < entries.length; start += PRESIGN_CHUNK) {
        if (abortRef.current) break;
        const chunkEntries = entries.slice(start, start + PRESIGN_CHUNK);
        const chunk = chunkEntries.map((e) => e.file);

        let uploads: Array<{ imageId: string; uploadUrl: string }> | undefined;
        try {
          const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId,
              sectionId: sectionIdRef.current || undefined,
              files: chunk.map((f) => ({ name: f.name, type: f.type, size: f.size })),
            }),
          });
          if (!response.ok) {
            for (const e of chunkEntries) {
              failedFilesRef.current.push(e.file);
              updateFile(e.id, {
                status: "error",
                error: `Server error (${response.status})`,
              });
            }
            continue;
          }
          uploads = (await response.json()).uploads;
        } catch (err) {
          for (const e of chunkEntries) {
            failedFilesRef.current.push(e.file);
            updateFile(e.id, {
              status: "error",
              error: err instanceof Error ? err.message : "Network error",
            });
          }
          continue;
        }

        if (!Array.isArray(uploads) || uploads.length < chunkEntries.length) {
          for (let i = uploads?.length ?? 0; i < chunkEntries.length; i++) {
            failedFilesRef.current.push(chunkEntries[i].file);
            updateFile(chunkEntries[i].id, {
              status: "error",
              error: "Server returned no upload URL",
            });
          }
        }

        (uploads ?? []).forEach((u, i) => {
          if (!chunkEntries[i]) return;
          queueRef.current.push({
            fileId: chunkEntries[i].id,
            file: chunk[i],
            imageId: u.imageId,
            uploadUrl: u.uploadUrl,
          });
        });
        drainQueue();
      }
    },
    [eventId, updateFile, drainQueue]
  );

  // ─── Drop handler: register files, hold duplicates, upload the rest ───
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      abortRef.current = false;
      setCorsError(false);

      // 1. Register every dropped file immediately (instant feedback).
      const baseId = `${performance.now()}`;
      const newEntries: UploadFile[] = acceptedFiles.map((file, i) => {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.add(previewUrl);
        return {
          id: `${baseId}-${i}`,
          file,
          previewUrl,
          status: "pending" as FileStatus,
          progress: 0,
        };
      });
      setFiles((prev) => [...prev, ...newEntries]);

      // 2. Check which filenames already exist in the target section. Dupes are
      //    HELD (status "duplicate") for Skip/Replace; the rest upload now.
      let dupMap: Record<string, string[]> = {};
      const targetSection = sectionIdRef.current;
      if (targetSection) {
        try {
          const res = await fetch(
            `/api/sections/${targetSection}/check-duplicates`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filenames: [...new Set(acceptedFiles.map((f) => f.name))],
              }),
            }
          );
          if (res.ok) dupMap = (await res.json()).duplicates ?? {};
        } catch {
          // If the check fails, fall through and upload everything (no worse
          // than before — better to allow than to block on a flaky check).
        }
      }

      const toUpload: UploadFile[] = [];
      for (const entry of newEntries) {
        const existing = dupMap[entry.file.name];
        if (existing && existing.length > 0) {
          updateFile(entry.id, {
            status: "duplicate",
            existingImageIds: existing,
          });
        } else {
          toUpload.push(entry);
        }
      }

      await uploadEntries(toUpload);
    },
    [updateFile, uploadEntries]
  );

  // Retry: when retryFiles prop changes, re-drop those files.
  const retryFilesRef = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (retryFiles && retryFiles.length > 0 && retryFiles !== retryFilesRef.current) {
      retryFilesRef.current = retryFiles;
      onDrop(retryFiles);
    }
  }, [retryFiles, onDrop]);

  // Revoke all object URLs on unmount.
  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  // Politely surface rejected files (wrong format / over the size cap) as
  // error rows instead of silently dropping them.
  const onDropRejected = useCallback(
    (rejections: readonly FileRejection[]) => {
      if (rejections.length === 0) return;
      const baseId = `rejected-${performance.now()}`;
      setFiles((prev) => [
        ...prev,
        ...rejections.map((r, i) => ({
          id: `${baseId}-${i}`,
          file: r.file,
          previewUrl: "",
          status: "error" as FileStatus,
          progress: 0,
          error:
            validateUploadFile({
              name: r.file.name,
              type: r.file.type,
              size: r.file.size,
            }) ||
            r.errors[0]?.message ||
            "Unsupported file",
        })),
      ]);
    },
    []
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: UPLOAD_ACCEPT,
    // Per-type size caps (100 MB images / 500 MB videos) live in the shared
    // validator, mirrored server-side in /api/upload.
    validator: (file) => {
      const problem = validateUploadFile({
        name: file.name,
        type: file.type,
        size: file.size,
      });
      return problem ? { code: "invalid-file", message: problem } : null;
    },
    useFsAccessApi: false, // traditional file dialog so CMD+A works in Finder
  });

  // ─── Counts (cumulative this session — completed rows stay counted even
  //     after they fall off the displayed list) ───
  const completedCount = files.filter((f) => f.status === "complete").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const duplicateFiles = useMemo(
    () => files.filter((f) => f.status === "duplicate"),
    [files]
  );
  const duplicateCount = duplicateFiles.length;
  const inFlight = files.filter(
    (f) => f.status === "pending" || f.status === "uploading"
  ).length;
  // Held duplicates aren't counted in the total/progress — they're awaiting a
  // Skip/Replace decision, not uploading.
  const totalCount = files.filter((f) => f.status !== "duplicate").length;
  const isUploading = inFlight > 0;

  // The displayed list shows what still needs attention: in-flight rows, errors
  // (completed fall off — they're in the grid below). Duplicates render in their
  // own group, so they're excluded here.
  const visibleFiles = useMemo(
    () => files.filter((f) => f.status === "pending" || f.status === "uploading" || f.status === "error"),
    [files]
  );

  // Only a window of rows actually mounts (each row decodes its original file
  // for the thumbnail — see MAX_RENDERED_ROWS). Errors need action, so they
  // always render first; active rows fill the rest and a footer counts the
  // queued remainder.
  const renderedFiles = useMemo(() => {
    if (visibleFiles.length <= MAX_RENDERED_ROWS) return visibleFiles;
    const errors = visibleFiles.filter((f) => f.status === "error");
    const active = visibleFiles.filter((f) => f.status !== "error");
    return [...errors, ...active].slice(0, MAX_RENDERED_ROWS);
  }, [visibleFiles]);
  const hiddenRowCount = visibleFiles.length - renderedFiles.length;

  // Overall session progress for the header bar: each file is one unit, with
  // in-flight files contributing their fractional bytes-sent — so the bar
  // creeps smoothly instead of stepping 1/2000th at a time.
  const overallPct = useMemo(() => {
    if (totalCount === 0) return 0;
    const inFlightSum = files.reduce(
      (acc, f) => acc + (f.status === "uploading" ? f.progress : 0),
      0
    );
    const done = files.filter((f) => f.status === "complete").length;
    return Math.min(100, ((done + inFlightSum / 100) / totalCount) * 100);
  }, [files, totalCount]);

  // ─── Duplicate resolution: Skip / Replace (per-file and bulk) ───
  const skipDuplicate = useCallback(
    (id: string) => removeFiles(new Set([id])),
    [removeFiles]
  );

  const replaceDuplicate = useCallback(
    async (entry: UploadFile) => {
      // Delete the existing image(s) with this filename in the section, then
      // upload the new file in their place.
      if (entry.existingImageIds?.length) {
        try {
          await fetch("/api/images/batch", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: entry.existingImageIds }),
          });
        } catch {
          /* best-effort; upload still proceeds */
        }
      }
      updateFile(entry.id, { status: "pending", progress: 0 });
      await uploadEntries([{ ...entry, status: "pending" }]);
    },
    [updateFile, uploadEntries]
  );

  const skipAllDuplicates = useCallback(() => {
    removeFiles(new Set(duplicateFiles.map((f) => f.id)));
  }, [duplicateFiles, removeFiles]);

  const replaceAllDuplicates = useCallback(async () => {
    const dupes = [...duplicateFiles];
    const allExisting = dupes.flatMap((d) => d.existingImageIds ?? []);
    if (allExisting.length) {
      try {
        await fetch("/api/images/batch", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: allExisting }),
        });
      } catch {
        /* best-effort */
      }
    }
    dupes.forEach((d) => updateFile(d.id, { status: "pending", progress: 0 }));
    await uploadEntries(dupes.map((d) => ({ ...d, status: "pending" as FileStatus })));
  }, [duplicateFiles, updateFile, uploadEntries]);

  // ─── Cancel: stop the session AND clean up every pre-created row ───
  // The old cancel just emptied the queue, stranding one presign-created DB
  // row per queued file — the largest single source of the eBay HEADSHOTS
  // ghost tiles. In-flight workers clean their own rows via the abort path
  // in uploadOne; not-yet-presigned entries have no rows to clean.
  const cancelUpload = useCallback(() => {
    abortRef.current = true;
    const queued = queueRef.current;
    queueRef.current = [];
    const dropIds = new Set(queued.map((t) => t.fileId));
    setFiles((prev) => {
      prev.forEach((f) => {
        if (dropIds.has(f.id) || f.status === "pending") {
          URL.revokeObjectURL(f.previewUrl);
          objectUrls.current.delete(f.previewUrl);
        }
      });
      return prev.filter((f) => !dropIds.has(f.id) && f.status !== "pending");
    });
    const queuedIds = queued.map((t) => t.imageId);
    for (let s = 0; s < queuedIds.length; s += 500) {
      fetch("/api/images/batch", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageIds: queuedIds.slice(s, s + 500) }),
        keepalive: true,
      }).catch(() => {
        /* the nightly reconciler is the backstop */
      });
    }
  }, []);

  // ─── Leaving mid-upload: warn, and clean up what provably can't finish ───
  // beforeunload prompts before the tab closes/navigates while uploads run.
  // pagehide (fires even when the user leaves anyway) deletes the rows of
  // QUEUED-but-never-started files via keepalive fetch. In-flight uploads die
  // with the page and can't be cleaned from here — the nightly reconciler
  // sweeps those.
  useEffect(() => {
    if (!isUploading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    const onPageHide = () => {
      const queuedIds = queueRef.current.map((t) => t.imageId);
      queueRef.current = [];
      for (let s = 0; s < queuedIds.length; s += 500) {
        fetch("/api/images/batch", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: queuedIds.slice(s, s + 500) }),
          keepalive: true,
        }).catch(() => {});
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [isUploading]);

  // ─── End-of-session truth check against the server ───
  // Ask /api/upload/reconcile whether every id we counted as complete is
  // actually finalized. Anything the server disputes flips back to a visible,
  // retryable error — local bookkeeping never gets the last word.
  const reconcileCompleted = useCallback(
    async (ids: string[]) => {
      const unfinalized = new Set<string>();
      const missing = new Set<string>();
      for (let s = 0; s < ids.length; s += 500) {
        try {
          const res = await fetch("/api/upload/reconcile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: ids.slice(s, s + 500) }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              unfinalized?: string[];
              missing?: string[];
            };
            data.unfinalized?.forEach((id) => unfinalized.add(id));
            data.missing?.forEach((id) => missing.add(id));
          }
        } catch {
          /* best-effort; the nightly reconciler is the backstop */
        }
      }
      if (unfinalized.size === 0 && missing.size === 0) return;
      setFiles((prev) =>
        prev.map((f) => {
          if (!f.imageId || f.status !== "complete") return f;
          if (unfinalized.has(f.imageId)) {
            // Binary landed; only the finalize is missing.
            return {
              ...f,
              status: "error" as FileStatus,
              error: "Not confirmed by server — retry",
              finalizeNeeded: true,
            };
          }
          if (missing.has(f.imageId)) {
            // Row vanished entirely — needs a full re-upload.
            return {
              ...f,
              status: "error" as FileStatus,
              error: "Upload lost — retry",
              finalizeNeeded: false,
            };
          }
          return f;
        })
      );
    },
    []
  );

  // ─── Report progress up to the page (single unified bar lives there) ───
  useEffect(() => {
    onProgressChange?.({
      active: isUploading,
      total: totalCount,
      uploaded: completedCount,
      failed: errorCount,
      inFlight,
    });
  }, [isUploading, totalCount, completedCount, errorCount, inFlight, onProgressChange]);

  // ─── Fire parent callbacks once the queue fully drains ───
  const wasUploadingRef = useRef(false);
  useEffect(() => {
    if (isUploading) {
      wasUploadingRef.current = true;
      return;
    }
    if (wasUploadingRef.current) {
      wasUploadingRef.current = false;
      if (failedFilesRef.current.length > 0) {
        onUploadFailed?.(failedFilesRef.current);
        failedFilesRef.current = [];
      }
      if (completedIdsRef.current.length > 0) {
        const completedIds = completedIdsRef.current;
        completedIdsRef.current = [];
        onUploadComplete?.(completedIds);
        // Verify against the server before letting the rows clear.
        setReconciling(true);
        reconcileCompleted(completedIds).finally(() => setReconciling(false));
      }
    }
  }, [isUploading, onUploadComplete, onUploadFailed, reconcileCompleted]);

  // ─── Auto-clear once everything has succeeded ───
  // When nothing is in flight and there's nothing left to act on (no errors,
  // no held duplicates), drop the completed rows so the block disappears — an
  // empty list is the "you're done" signal. Held duplicates/errors keep the
  // block alive until resolved. Only complete rows are cleared.
  useEffect(() => {
    if (!isUploading && !reconciling && errorCount === 0 && duplicateCount === 0 && files.length > 0) {
      const t = setTimeout(() => {
        setFiles((prev) => {
          prev.forEach((f) => {
            if (f.status === "complete") {
              URL.revokeObjectURL(f.previewUrl);
              objectUrls.current.delete(f.previewUrl);
            }
          });
          return prev.filter((f) => f.status !== "complete");
        });
      }, 600);
      return () => clearTimeout(t);
    }
  }, [isUploading, reconciling, errorCount, duplicateCount, files.length]);

  // Retry a finalize-only failure: the binary is already in R2, so just
  // re-run /api/upload/complete rather than re-uploading the bytes.
  const retryFinalize = useCallback(
    async (entry: UploadFile) => {
      if (!entry.imageId) return;
      updateFile(entry.id, { status: "uploading", progress: 100, error: undefined });
      const finalized = await finalizeUpload(entry.imageId, entry.file);
      if (finalized) {
        updateFile(entry.id, { status: "complete", finalizeNeeded: false });
        completedIdsRef.current.push(entry.imageId);
        onImageUploaded?.(entry.imageId);
      } else {
        updateFile(entry.id, {
          status: "error",
          error: "Uploaded, but not confirmed — retry",
        });
      }
    },
    [updateFile, finalizeUpload, onImageUploaded]
  );

  const retryFile = useCallback(
    async (entry: UploadFile) => {
      if (entry.finalizeNeeded && entry.imageId) {
        await retryFinalize(entry);
        return;
      }
      if (entry.imageId) {
        try {
          await fetch("/api/images/batch", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: [entry.imageId] }),
          });
        } catch {
          /* non-critical */
        }
      }
      removeFiles(new Set([entry.id]));
      onDrop([entry.file]);
    },
    [onDrop, removeFiles, retryFinalize]
  );

  const retryAllFailed = useCallback(async () => {
    const errorFiles = files.filter((f) => f.status === "error");

    // Finalize-only failures re-confirm in place (binary already in R2).
    const finalizeRetries = errorFiles.filter((f) => f.finalizeNeeded && f.imageId);
    await Promise.all(finalizeRetries.map((f) => retryFinalize(f)));

    // True upload failures re-upload from scratch (delete ghost row first).
    const reuploads = errorFiles.filter((f) => !(f.finalizeNeeded && f.imageId));
    if (reuploads.length === 0) return;
    const errorIds = new Set(reuploads.map((f) => f.id));
    const orphanImageIds = reuploads
      .map((f) => f.imageId)
      .filter(Boolean) as string[];
    if (orphanImageIds.length > 0) {
      try {
        await fetch("/api/images/batch", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageIds: orphanImageIds }),
        });
      } catch {
        /* non-critical */
      }
    }
    const rawFiles = reuploads.map((f) => f.file);
    removeFiles(errorIds);
    onDrop(rawFiles);
  }, [files, onDrop, removeFiles, retryFinalize]);

  return (
    <div className="space-y-6">
      {/* ─── CORS / infrastructure error banner ─── */}
      {corsError && (
        <div className="flex items-start gap-3 border border-red-200 bg-red-50 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] font-medium text-red-800">
              Storage configuration required
            </p>
            <p className="text-[12px] leading-relaxed text-red-600">
              Large uploads (over 4 MB) are blocked because the R2 bucket has no
              CORS policy. Smaller files still upload via the server. To enable
              large direct uploads, run{" "}
              <code className="rounded bg-red-100 px-1 py-0.5 text-[11px] font-mono">
                node scripts/setup-r2-cors.mjs
              </code>{" "}
              or configure CORS in the Cloudflare R2 dashboard.
            </p>
          </div>
        </div>
      )}

      {/* ─── Drop zone ─── */}
      <div
        {...getRootProps()}
        className={cn(
          "relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center border border-dashed p-12 text-center transition-all duration-300",
          isDragActive
            ? "border-accent bg-accent-muted/30"
            : "border-stone-300 hover:border-stone-400"
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            "mb-4 h-8 w-8 transition-colors duration-300",
            isDragActive ? "text-accent" : "text-stone-300"
          )}
        />
        {isDragActive ? (
          <p className="font-editorial text-lg text-accent">
            Drop images or video here
          </p>
        ) : (
          <>
            <p className="font-editorial text-lg text-stone-700">
              Drag &amp; drop images or video here
            </p>
            <p className="mt-2 text-[13px] text-stone-400 leading-relaxed">
              or click to browse — JPEG, PNG, TIFF, WebP up to 100 MB ·
              MP4/MOV (H.264) up to 500 MB
            </p>
          </>
        )}
        {sectionName && (
          <p className="mt-3 text-[11px] uppercase tracking-[0.12em] font-medium text-accent">
            Uploading to: {sectionName}
          </p>
        )}
        {isUploading && (
          <p className="mt-3 text-[11px] text-stone-400">
            Uploading {completedCount} of {totalCount}
            {errorCount > 0 && ` · ${errorCount} failed`} — you can keep adding
            files
          </p>
        )}
      </div>

      {/* ─── Duplicates held for a decision ─── */}
      {duplicateCount > 0 && (
        <div className="space-y-2 border border-amber-200 bg-amber-50/50 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[13px] font-medium text-amber-900">
              <Copy className="h-3.5 w-3.5" />
              {duplicateCount} already in {sectionName || "this section"}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={replaceAllDuplicates}
                className="text-[12px] font-medium text-amber-900 hover:text-amber-700 transition-colors"
              >
                Replace all
              </button>
              <button
                onClick={skipAllDuplicates}
                className="text-[12px] text-stone-500 hover:text-stone-800 transition-colors"
              >
                Skip all
              </button>
            </div>
          </div>
          <div className="max-h-[220px] space-y-px overflow-y-auto">
            {duplicateFiles.slice(0, MAX_RENDERED_ROWS).map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 border-b border-amber-100/70 py-1.5 text-[13px] last:border-b-0"
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-stone-100">
                  <FilePreview file={f.file} previewUrl={f.previewUrl} />
                </div>
                <span className="flex-1 truncate text-stone-700">{f.file.name}</span>
                <button
                  onClick={() => replaceDuplicate(f)}
                  className="text-[12px] font-medium text-amber-900 hover:text-amber-700 transition-colors"
                >
                  Replace
                </button>
                <button
                  onClick={() => skipDuplicate(f.id)}
                  className="text-[12px] text-stone-500 hover:text-stone-800 transition-colors"
                >
                  Skip
                </button>
              </div>
            ))}
            {duplicateCount > MAX_RENDERED_ROWS && (
              <div className="py-2 text-[12px] text-amber-800/70">
                + {(duplicateCount - MAX_RENDERED_ROWS).toLocaleString()} more —
                use Replace all or Skip all above
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Active/error list ─── */}
      {/* Shown only while there's something to act on: in-flight uploads or
          errors. Completed rows fall off; when the list empties the block is
          gone, signalling "all done". */}
      {visibleFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <span className="label-caps shrink-0">
              {isUploading
                ? `Uploading ${completedCount} / ${totalCount}`
                : errorCount > 0
                ? `${completedCount} uploaded · ${errorCount} failed`
                : `${completedCount} uploaded`}
            </span>
            {/* Live session progress — fills the dead space between the count
                and the actions. Count-weighted with fractional credit for
                in-flight files, so it creeps rather than steps. */}
            {isUploading && (
              <div className="hidden sm:block h-[3px] flex-1 rounded-full bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                  style={{ width: `${overallPct}%` }}
                />
              </div>
            )}
            <div className="flex items-center gap-4 shrink-0">
              {!isUploading && errorCount > 0 && (
                <button
                  onClick={retryAllFailed}
                  className="flex items-center gap-1 text-[12px] text-accent hover:text-accent/80 transition-colors duration-300"
                >
                  <RotateCcw className="h-3 w-3" />
                  Retry {errorCount} failed
                </button>
              )}
              {isUploading && (
                <button
                  onClick={cancelUpload}
                  className="text-[12px] text-red-400 hover:text-red-600 transition-colors duration-300"
                >
                  Cancel
                </button>
              )}
              {!isUploading && errorCount > 0 && (
                <button
                  onClick={() => removeFiles(new Set(files.map((f) => f.id)))}
                  className="text-[12px] text-stone-400 hover:text-stone-700 transition-colors duration-300"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          {/* List with thumbnails — in-flight + errors only (windowed) */}
          <div className="max-h-[340px] space-y-px overflow-y-auto">
            {renderedFiles.map((f) => (
              <div
                key={f.id}
                className="relative flex items-center gap-3 border-b border-stone-100 px-0 py-2 text-[13px]"
              >
                {/* Determinate progress: gray track + green fill that grows
                    left→right with real bytes-sent, so a quick upload visibly
                    fills then the row drops off. */}
                {(f.status === "pending" || f.status === "uploading") && (
                  <span className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-full bg-stone-200">
                    <span
                      className="block h-full bg-accent transition-[width] duration-200 ease-out"
                      style={{ width: `${f.progress}%` }}
                    />
                  </span>
                )}

                {/* Thumbnail preview */}
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-stone-100">
                  <div
                    className={cn(
                      "h-full w-full transition-opacity duration-300",
                      f.status === "error" ? "opacity-40" : "opacity-100"
                    )}
                  >
                    <FilePreview file={f.file} previewUrl={f.previewUrl} />
                  </div>
                  {(f.status === "pending" || f.status === "uploading") && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    </div>
                  )}
                </div>

                <span className="flex-1 truncate text-stone-600">{f.file.name}</span>
                <span className="shrink-0 text-[12px] text-stone-300">
                  {formatFileSize(f.file.size)}
                </span>

                {f.status === "error" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="max-w-[180px] truncate text-[11px] text-red-400">
                      {f.error || "Upload failed"}
                    </span>
                    <button
                      onClick={() => retryFile(f)}
                      className="flex items-center gap-0.5 text-[11px] text-stone-400 hover:text-stone-700 transition-colors duration-200"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </button>
                  </div>
                )}
              </div>
            ))}
            {hiddenRowCount > 0 && (
              <div className="py-2 text-[12px] text-stone-400">
                + {hiddenRowCount.toLocaleString()} more queued — rows appear
                here as they upload
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
