"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";
import { extractExif } from "@/lib/upload/parse-filename";

const BATCH_SIZE = 50;
const MAX_CONCURRENT_UPLOADS = 12;

/**
 * CORS failures from direct-to-R2 uploads manifest as TypeError("Failed to fetch")
 * with no response body. After this many consecutive TypeErrors on R2 PUTs,
 * we surface a CORS configuration error instead of per-file errors.
 */
const CORS_FAILURE_THRESHOLD = 3;

type FileStatus = "pending" | "uploading" | "processing" | "complete" | "error";
type FilterTab = "all" | "uploading" | "done" | "errors";

interface UploadFile {
  id: string;
  file: File;
  status: FileStatus;
  progress: number;
  error?: string;
  imageId?: string;
}

interface UploadZoneProps {
  eventId: string;
  onUploadComplete?: (imageIds: string[]) => void;
  onUploadFailed?: (files: File[]) => void;
  retryFiles?: File[];
}

/** Worker-pool pattern for concurrency-limited async tasks */
async function processPool<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  concurrency: number
): Promise<void> {
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
}

export function UploadZone({ eventId, onUploadComplete, onUploadFailed, retryFiles }: UploadZoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [activeUploads, setActiveUploads] = useState(0);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [corsError, setCorsError] = useState(false);
  const isUploading = activeUploads > 0;
  const abortRef = useRef(false);
  const corsFailureCount = useRef(0);

  const updateFile = useCallback(
    (id: string, update: Partial<UploadFile>) => {
      setFiles((prev) =>
        prev.map((f) => (f.id === id ? { ...f, ...update } : f))
      );
    },
    []
  );

  const removeFiles = useCallback((ids: Set<string>) => {
    setFiles((prev) => prev.filter((f) => !ids.has(f.id)));
  }, []);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      abortRef.current = false;
      corsFailureCount.current = 0;
      setCorsError(false);

      const newFiles: UploadFile[] = acceptedFiles.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        file,
        status: "pending",
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
      setActiveUploads((c) => c + 1);

      const completedIds: string[] = [];
      const succeededIndices = new Set<number>();

      try {
        // Process files in batches of BATCH_SIZE
        for (
          let batchStart = 0;
          batchStart < acceptedFiles.length;
          batchStart += BATCH_SIZE
        ) {
          if (abortRef.current) break;

          const batchEnd = Math.min(
            batchStart + BATCH_SIZE,
            acceptedFiles.length
          );
          const batchFiles = acceptedFiles.slice(batchStart, batchEnd);
          const batchNewFiles = newFiles.slice(batchStart, batchEnd);

          // 1. Get presigned URLs for this batch
          let response: Response;
          try {
            response = await fetch("/api/upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                eventId,
                files: batchFiles.map((f) => ({
                  name: f.name,
                  type: f.type,
                  size: f.size,
                })),
              }),
            });
          } catch (err) {
            // Network error — mark batch as failed, try next
            for (const nf of batchNewFiles) {
              updateFile(nf.id, {
                status: "error",
                error:
                  err instanceof Error ? err.message : "Network error",
              });
            }
            continue;
          }

          if (!response.ok) {
            for (const nf of batchNewFiles) {
              updateFile(nf.id, {
                status: "error",
                error: `Server error (${response.status})`,
              });
            }
            continue;
          }

          const { uploads } = await response.json();

          // 2. Upload files directly to R2 via presigned URLs
          const uploadTasks = uploads.map(
            (
              upload: { imageId: string; r2Key: string; uploadUrl: string },
              index: number
            ) => ({
              upload,
              file: batchFiles[index],
              fileId: batchNewFiles[index].id,
              originalIndex: batchStart + index,
            })
          );

          await processPool(
            uploadTasks,
            async (task: {
              upload: { imageId: string; r2Key: string; uploadUrl: string };
              file: File;
              fileId: string;
              originalIndex: number;
            }) => {
              if (abortRef.current) return;

              try {
                updateFile(task.fileId, { status: "uploading" });

                // Upload directly to R2 via presigned URL (no size limit)
                let uploadRes: Response;
                try {
                  uploadRes = await fetch(task.upload.uploadUrl, {
                    method: "PUT",
                    body: task.file,
                    headers: { "Content-Type": task.file.type },
                  });
                } catch (fetchErr) {
                  // TypeError("Failed to fetch") is the browser's signal for CORS blocks.
                  // Track consecutive failures — if systematic, it's a CORS config issue.
                  if (fetchErr instanceof TypeError) {
                    corsFailureCount.current++;
                    if (corsFailureCount.current >= CORS_FAILURE_THRESHOLD) {
                      setCorsError(true);
                      abortRef.current = true;
                    }
                  }
                  throw fetchErr;
                }

                if (!uploadRes.ok) {
                  throw new Error(`Upload failed (${uploadRes.status})`);
                }

                // R2 PUT succeeded — reset CORS failure counter
                corsFailureCount.current = 0;

                // Mark as complete immediately
                updateFile(task.fileId, {
                  status: "complete",
                  progress: 100,
                  imageId: task.upload.imageId,
                });

                // Extract EXIF (non-blocking), then ALWAYS call complete
                // This ensures AI processing triggers even if EXIF fails
                (async () => {
                  let exifData: Record<string, unknown> = {};
                  try {
                    const buf = await task.file.arrayBuffer();
                    const exif = await extractExif(buf);
                    if (exif) exifData = exif;
                  } catch {
                    // EXIF extraction is non-critical
                  }

                  // Always fire — triggers thumbnails + AI pipeline
                  try {
                    await fetch("/api/upload/complete", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        imageId: task.upload.imageId,
                        width: (exifData as { width?: number }).width ?? null,
                        height: (exifData as { height?: number }).height ?? null,
                        exif: exifData,
                      }),
                    });
                  } catch {
                    // Non-critical — thumbnails/AI will be retried
                  }
                })();

                completedIds.push(task.upload.imageId);
                succeededIndices.add(task.originalIndex);
              } catch (err) {
                updateFile(task.fileId, {
                  status: "error",
                  error:
                    err instanceof TypeError
                      ? "Storage connection failed"
                      : err instanceof Error ? err.message : "Upload failed",
                });
              }
            },
            MAX_CONCURRENT_UPLOADS
          );
        }

        if (completedIds.length > 0) {
          onUploadComplete?.(completedIds);
        }

        // Collect failed files and notify parent
        const failedFiles = acceptedFiles.filter(
          (_, index) => !succeededIndices.has(index)
        );
        if (failedFiles.length > 0) {
          onUploadFailed?.(failedFiles);
        }
      } catch (err) {
        console.error("Upload error:", err);
      } finally {
        setActiveUploads((c) => c - 1);
      }
    },
    [eventId, onUploadComplete, onUploadFailed, updateFile]
  );

  // Handle retry: when retryFiles prop is set with files, trigger upload
  const retryFilesRef = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (
      retryFiles &&
      retryFiles.length > 0 &&
      retryFiles !== retryFilesRef.current &&
      !isUploading
    ) {
      retryFilesRef.current = retryFiles;
      onDrop(retryFiles);
    }
  }, [retryFiles, isUploading, onDrop]);

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
  });

  // ─── Counts ───
  const uploadingCount = files.filter(
    (f) => f.status === "pending" || f.status === "uploading" || f.status === "processing"
  ).length;
  const completedCount = files.filter((f) => f.status === "complete").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const totalCount = files.length;

  // ─── Filtered file list ───
  const filteredFiles = useMemo(() => {
    switch (filterTab) {
      case "uploading":
        return files.filter(
          (f) => f.status === "pending" || f.status === "uploading" || f.status === "processing"
        );
      case "done":
        return files.filter((f) => f.status === "complete");
      case "errors":
        return files.filter((f) => f.status === "error");
      default:
        return files;
    }
  }, [files, filterTab]);

  // ─── Retry helpers ───
  const retryFile = useCallback(
    (fileEntry: UploadFile) => {
      removeFiles(new Set([fileEntry.id]));
      onDrop([fileEntry.file]);
    },
    [onDrop, removeFiles]
  );

  const retryAllFailed = useCallback(() => {
    const errorFiles = files.filter((f) => f.status === "error");
    const errorIds = new Set(errorFiles.map((f) => f.id));
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
              Uploads are being blocked by the storage provider. CORS must be
              configured on the R2 bucket to allow direct browser uploads.
              Run{" "}
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
            : "border-stone-300 hover:border-stone-400",
          isUploading && "opacity-60"
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
            Drop images here
          </p>
        ) : (
          <>
            <p className="font-editorial text-lg text-stone-700">
              Drag & drop images here
            </p>
            <p className="mt-2 text-[13px] text-stone-400 leading-relaxed">
              or click to browse — JPEG, PNG, TIFF, WebP, HEIC up to 100 MB
            </p>
          </>
        )}
      </div>

      {/* ─── Upload progress ─── */}
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="label-caps">
              {isUploading
                ? `Uploading ${completedCount} / ${totalCount}`
                : completedCount === totalCount && totalCount > 0
                ? `${completedCount} uploaded`
                : `${completedCount} uploaded, ${errorCount} failed`}
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
                  }}
                  className="text-[12px] text-red-400 hover:text-red-600 transition-colors duration-300"
                >
                  Cancel
                </button>
              )}
              {!isUploading && (
                <button
                  onClick={() => setFiles([])}
                  className="text-[12px] text-stone-400 hover:text-stone-700 transition-colors duration-300"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* ─── Progress bar ─── */}
          {totalCount > 0 && (
            <div className="h-1 bg-stone-100 w-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-500 ease-out"
                style={{
                  width: `${(completedCount / totalCount) * 100}%`,
                }}
              />
            </div>
          )}

          {/* ─── Filter tabs ─── */}
          {totalCount > 0 && (
            <div className="flex items-center gap-1.5">
              {(
                [
                  { id: "all" as FilterTab, label: "All", count: totalCount },
                  { id: "uploading" as FilterTab, label: "Uploading", count: uploadingCount },
                  { id: "done" as FilterTab, label: "Done", count: completedCount },
                  { id: "errors" as FilterTab, label: "Errors", count: errorCount },
                ] as const
              )
                .filter((tab) => tab.id === "all" || tab.count > 0)
                .map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setFilterTab(tab.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] transition-colors duration-200",
                      filterTab === tab.id
                        ? "bg-stone-900 text-white"
                        : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                    )}
                  >
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="ml-1 opacity-60">{tab.count}</span>
                    )}
                  </button>
                ))}
            </div>
          )}

          {/* ─── File list ─── */}
          <div className="max-h-[300px] space-y-px overflow-y-auto">
            {filteredFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 border-b border-stone-100 px-0 py-2.5 text-[13px]"
              >
                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-300" />
                <span className="flex-1 truncate text-stone-600">
                  {f.file.name}
                </span>
                <span className="shrink-0 text-[12px] text-stone-300">
                  {formatFileSize(f.file.size)}
                </span>

                {/* Status indicators */}
                {(f.status === "pending" || f.status === "uploading") && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-stone-400" />
                )}
                {f.status === "processing" && (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
                )}
                {f.status === "complete" && (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                )}
                {f.status === "error" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-red-400 truncate max-w-[200px]">
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
