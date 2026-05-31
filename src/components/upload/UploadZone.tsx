"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Loader2,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";
import { extractExif } from "@/lib/upload/parse-filename";

const PRESIGN_CHUNK = 50; // how many files we request presigned URLs for at once
const MAX_CONCURRENT_UPLOADS = 12;
const R2_PUT_RETRIES = 2;
const R2_RETRY_BASE_MS = 1000;
/** Hard ceiling on a single upload so a hung connection can't spin forever. */
const R2_PUT_TIMEOUT_MS = 120_000;
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

type FileStatus = "pending" | "uploading" | "complete" | "error";

interface UploadFile {
  id: string;
  file: File;
  previewUrl: string;
  status: FileStatus;
  error?: string;
  imageId?: string;
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

  const abortRef = useRef(false);
  const corsFailureCount = useRef(0);
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

  // ─── Upload a single task (proxy for small files, direct for large) ───
  const uploadOne = useCallback(
    async (task: UploadTask) => {
      if (abortRef.current) return;
      updateFile(task.fileId, { status: "uploading" });

      const useProxy = task.file.size <= PROXY_MAX_BYTES;
      const target = useProxy ? `/api/upload/${task.imageId}` : task.uploadUrl;

      let ok = false;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= R2_PUT_RETRIES; attempt++) {
        if (abortRef.current) return;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), R2_PUT_TIMEOUT_MS);
        try {
          const res = await fetch(target, {
            method: "PUT",
            body: task.file,
            headers: { "Content-Type": task.file.type },
            signal: controller.signal,
          });
          if (res.ok) {
            ok = true;
            break;
          }
          lastErr = new Error(`Upload failed (${res.status})`);
        } catch (err) {
          lastErr = err;
          // CORS only afflicts the DIRECT path; never blame it for the proxy.
          if (!useProxy && err instanceof TypeError) {
            corsFailureCount.current++;
            if (corsFailureCount.current >= CORS_FAILURE_THRESHOLD) {
              setCorsError(true);
              abortRef.current = true;
              break;
            }
          }
        } finally {
          clearTimeout(timeoutId);
        }
        if (attempt < R2_PUT_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, R2_RETRY_BASE_MS * Math.pow(2, attempt))
          );
        }
      }

      if (!ok) {
        failedFilesRef.current.push(task.file);
        updateFile(task.fileId, {
          status: "error",
          imageId: task.imageId,
          error:
            lastErr instanceof TypeError
              ? "Storage connection failed"
              : lastErr instanceof Error
              ? lastErr.message
              : "Upload failed",
        });
        return;
      }

      corsFailureCount.current = 0;

      // Extract EXIF (best-effort) and tell the server we're done.
      let exifData: Record<string, unknown> = {};
      try {
        const buf = await task.file.arrayBuffer();
        const exif = await extractExif(buf);
        if (exif) exifData = exif;
      } catch {
        // EXIF is non-critical
      }

      const COMPLETE_RETRIES = 2;
      for (let attempt = 0; attempt <= COMPLETE_RETRIES; attempt++) {
        try {
          const res = await fetch("/api/upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              imageId: task.imageId,
              width: (exifData as { width?: number }).width ?? null,
              height: (exifData as { height?: number }).height ?? null,
              exif: exifData,
            }),
          });
          if (res.ok) break;
        } catch {
          // retry
        }
        if (attempt < COMPLETE_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Mark complete — the binary is in R2 and the row exists. The grid can
      // show it now, and the row falls off the upload list (it's filtered out
      // of the displayed list below).
      updateFile(task.fileId, { status: "complete", imageId: task.imageId });
      completedIdsRef.current.push(task.imageId);
      onImageUploaded?.(task.imageId);
    },
    [updateFile, onImageUploaded]
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

  // ─── Drop handler: registers files, fetches presigned URLs, enqueues ───
  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      abortRef.current = false;
      setCorsError(false);

      // 1. Add every dropped file to the list immediately (instant feedback,
      //    even while a previous batch is still uploading).
      const baseId = `${performance.now()}`;
      const newEntries: UploadFile[] = acceptedFiles.map((file, i) => {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.add(previewUrl);
        return {
          id: `${baseId}-${i}`,
          file,
          previewUrl,
          status: "pending" as FileStatus,
        };
      });
      setFiles((prev) => [...prev, ...newEntries]);

      // 2. Request presigned URLs in chunks and enqueue as they arrive, so
      //    workers can start on the first chunk while later chunks resolve.
      for (let start = 0; start < acceptedFiles.length; start += PRESIGN_CHUNK) {
        if (abortRef.current) break;
        const chunk = acceptedFiles.slice(start, start + PRESIGN_CHUNK);
        const chunkEntries = newEntries.slice(start, start + PRESIGN_CHUNK);

        let uploads: Array<{ imageId: string; uploadUrl: string }> | undefined;
        try {
          const response = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId,
              sectionId: sectionIdRef.current || undefined,
              files: chunk.map((f) => ({
                name: f.name,
                type: f.type,
                size: f.size,
              })),
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
          const data = await response.json();
          uploads = data.uploads;
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

        // Any file without a matching presigned URL is failed, not stranded.
        if (!Array.isArray(uploads) || uploads.length < chunkEntries.length) {
          for (let i = uploads?.length ?? 0; i < chunkEntries.length; i++) {
            failedFilesRef.current.push(chunkEntries[i].file);
            updateFile(chunkEntries[i].id, {
              status: "error",
              error: "Server returned no upload URL",
            });
          }
        }

        // Enqueue the resolved tasks and kick the pool.
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/tiff": [".tiff", ".tif"],
      "image/webp": [".webp"],
      "image/heic": [".heic", ".heif"],
    },
    maxSize: 100 * 1024 * 1024,
    useFsAccessApi: false, // traditional file dialog so CMD+A works in Finder
  });

  // ─── Counts (cumulative this session — completed rows stay counted even
  //     after they fall off the displayed list) ───
  const completedCount = files.filter((f) => f.status === "complete").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const inFlight = files.filter(
    (f) => f.status === "pending" || f.status === "uploading"
  ).length;
  const totalCount = files.length;
  const isUploading = inFlight > 0;

  // The displayed list shows only what still needs attention: in-flight rows
  // and errors. Completed uploads fall off (they appear in the grid below).
  const visibleFiles = useMemo(
    () => files.filter((f) => f.status !== "complete"),
    [files]
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
        onUploadComplete?.(completedIdsRef.current);
        completedIdsRef.current = [];
      }
    }
  }, [isUploading, onUploadComplete, onUploadFailed]);

  // ─── Auto-clear once everything has succeeded ───
  // When nothing is in flight and there are no errors to act on, drop the
  // (all-complete) rows so the block disappears entirely — an empty list is
  // the "you're done" signal. A short beat lets the last row settle first.
  useEffect(() => {
    if (!isUploading && errorCount === 0 && files.length > 0) {
      const t = setTimeout(() => {
        setFiles((prev) => {
          prev.forEach((f) => {
            URL.revokeObjectURL(f.previewUrl);
            objectUrls.current.delete(f.previewUrl);
          });
          return [];
        });
      }, 600);
      return () => clearTimeout(t);
    }
  }, [isUploading, errorCount, files.length]);

  const retryFile = useCallback(
    async (entry: UploadFile) => {
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
    [onDrop, removeFiles]
  );

  const retryAllFailed = useCallback(async () => {
    const errorFiles = files.filter((f) => f.status === "error");
    const errorIds = new Set(errorFiles.map((f) => f.id));
    const orphanImageIds = errorFiles
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
    const rawFiles = errorFiles.map((f) => f.file);
    removeFiles(errorIds);
    onDrop(rawFiles);
  }, [files, onDrop, removeFiles]);

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
          <p className="font-editorial text-lg text-accent">Drop images here</p>
        ) : (
          <>
            <p className="font-editorial text-lg text-stone-700">
              Drag &amp; drop images here
            </p>
            <p className="mt-2 text-[13px] text-stone-400 leading-relaxed">
              or click to browse — JPEG, PNG, TIFF, WebP, HEIC up to 100 MB
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

      {/* ─── Active/error list ─── */}
      {/* Shown only while there's something to act on: in-flight uploads or
          errors. Completed rows fall off; when the list empties the block is
          gone, signalling "all done". */}
      {visibleFiles.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="label-caps">
              {isUploading
                ? `Uploading ${completedCount} / ${totalCount}`
                : errorCount > 0
                ? `${completedCount} uploaded · ${errorCount} failed`
                : `${completedCount} uploaded`}
            </span>
            <div className="flex items-center gap-4">
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
                  onClick={() => {
                    abortRef.current = true;
                    queueRef.current = [];
                  }}
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

          {/* List with thumbnails — in-flight + errors only */}
          <div className="max-h-[340px] space-y-px overflow-y-auto">
            {visibleFiles.map((f) => (
              <div
                key={f.id}
                className="relative flex items-center gap-3 border-b border-stone-100 px-0 py-2 text-[13px]"
              >
                {/* Indeterminate progress bar across the row while uploading. */}
                {(f.status === "pending" || f.status === "uploading") && (
                  <span className="processing-bar pointer-events-none absolute bottom-0 left-0 h-[2px] w-full" />
                )}

                {/* Thumbnail preview */}
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded bg-stone-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.previewUrl}
                    alt={f.file.name}
                    className={cn(
                      "h-full w-full object-cover transition-opacity duration-300",
                      f.status === "error" ? "opacity-40" : "opacity-100"
                    )}
                  />
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
          </div>
        </div>
      )}
    </div>
  );
}
