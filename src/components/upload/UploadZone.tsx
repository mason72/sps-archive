"use client";

import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { Upload, Loader2, RotateCcw, ShieldAlert, Copy, Film } from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";
import { UPLOAD_ACCEPT, isVideoMime, validateUploadFile } from "@/lib/upload/media";
import {
  useUploadManager,
  unfinishedKey,
  unfinishedDismissedKey,
  type UploadFile,
  type FileStatus,
} from "./UploadManager";

/**
 * Cap on how many file rows are RENDERED at once. Every rendered row mounts an
 * <img> whose object URL makes the browser decode the ORIGINAL file — a 24 MP
 * JPEG decodes to ~100 MB of bitmap, so a 2000-file drop rendered in full
 * killed the tab before a single byte reached the server (Appfolio, Jul 2026).
 */
const MAX_RENDERED_ROWS = 30;

interface UploadZoneProps {
  eventId: string;
  /** Gallery name — carried onto the batch so the dock can name it. */
  eventName?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
  /** Files to re-drop (retry), passed down from the page's failed-upload list. */
  retryFiles?: File[];
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
      alt=""
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  );
}

/** A file row plus the batch it belongs to — actions need both. */
type Row = UploadFile & { batchId: string; batchSectionName: string | null };

/**
 * UploadZone — the VIEW over the upload engine.
 *
 * It owns no queue. Everything durable (tasks, workers, progress, cleanup)
 * lives in UploadManager, above the router, because this component is mounted
 * with a key tied to the active section and used to be destroyed — along with
 * the entire in-flight queue — whenever that section changed.
 *
 * It shows every batch for THIS event, not just the selected section: if you
 * dumped photos into one section and print exports into another, both are
 * visible while you carry on organizing.
 */
export function UploadZone({
  eventId,
  eventName,
  sectionId,
  sectionName,
  retryFiles,
}: UploadZoneProps) {
  const {
    batches,
    speedMbps,
    corsError,
    startBatch,
    cancelBatch,
    removeFiles,
    updateFile,
    uploadEntries,
    retryFinalize,
  } = useUploadManager();

  const [rejected, setRejected] = useState<UploadFile[]>([]);
  const [unfinished, setUnfinished] = useState<string[]>([]);
  const [unfinishedTotal, setUnfinishedTotal] = useState(0);

  const myBatches = useMemo(
    () => batches.filter((b) => b.eventId === eventId),
    [batches, eventId]
  );

  const rows = useMemo<Row[]>(
    () =>
      myBatches.flatMap((b) =>
        b.files.map((f) => ({
          ...f,
          batchId: b.id,
          batchSectionName: b.sectionName,
        }))
      ),
    [myBatches]
  );

  const allRows = useMemo<Row[]>(
    () => [
      ...rows,
      ...rejected.map((f) => ({
        ...f,
        batchId: "",
        batchSectionName: null,
      })),
    ],
    [rows, rejected]
  );

  const completedCount = allRows.filter((f) => f.status === "complete").length;
  const errorCount = allRows.filter((f) => f.status === "error").length;
  const duplicateRows = useMemo(
    () => allRows.filter((f) => f.status === "duplicate"),
    [allRows]
  );
  const duplicateCount = duplicateRows.length;
  const inFlight = allRows.filter(
    (f) => f.status === "pending" || f.status === "uploading"
  ).length;
  const totalCount = allRows.filter((f) => f.status !== "duplicate").length;
  const isUploading = inFlight > 0;

  // ─── Drop ───
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted.length === 0) return;
      setUnfinished([]);
      setUnfinishedTotal(0);
      void startBatch({
        eventId,
        eventName: eventName ?? null,
        sectionId: sectionId ?? null,
        sectionName: sectionName ?? null,
        files: accepted,
      });
    },
    [eventId, eventName, sectionId, sectionName, startBatch]
  );

  // Retry: when retryFiles changes, re-drop those files.
  const retryFilesRef = useRef<File[] | undefined>(undefined);
  useEffect(() => {
    if (retryFiles && retryFiles.length > 0 && retryFiles !== retryFilesRef.current) {
      retryFilesRef.current = retryFiles;
      onDrop(retryFiles);
    }
  }, [retryFiles, onDrop]);

  // Politely surface rejected files (wrong format / over the size cap).
  const onDropRejected = useCallback((rejections: readonly FileRejection[]) => {
    if (rejections.length === 0) return;
    const baseId = `rejected-${performance.now()}`;
    setRejected((prev) => [
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
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: UPLOAD_ACCEPT,
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

  // ─── Unfinished-work recovery (server-authoritative, localStorage tail) ───
  useEffect(() => {
    let cancelled = false;
    const readLocal = (): string[] => {
      try {
        const raw = localStorage.getItem(unfinishedKey(eventId));
        return raw ? ((JSON.parse(raw) as { files?: string[] })?.files ?? []) : [];
      } catch {
        return [];
      }
    };
    const dismissedAt = (): number => {
      try {
        return Number(localStorage.getItem(unfinishedDismissedKey(eventId)) ?? 0);
      } catch {
        return 0;
      }
    };
    const local = readLocal();
    const apply = (serverNames: string[], serverCount: number) => {
      const names = Array.from(new Set([...serverNames, ...local]));
      const total = Math.max(serverCount, names.length);
      // Exact repeats only: dismissing a 2,258-file loss must not silence a
      // later 5-file one.
      if (total === 0 || total === dismissedAt()) return;
      setUnfinished(names);
      setUnfinishedTotal(total);
    };
    apply([], local.length);
    (async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/unfinished-uploads`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { count?: number; filenames?: string[] };
        if (cancelled) return;
        apply(data.filenames ?? [], data.count ?? 0);
      } catch {
        /* the local manifest already covers the offline case */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    if (isUploading) {
      setUnfinished([]);
      setUnfinishedTotal(0);
    }
  }, [isUploading]);

  // ─── Displayed list ───
  const visibleFiles = useMemo(
    () =>
      allRows.filter(
        (f) =>
          f.status === "pending" || f.status === "uploading" || f.status === "error"
      ),
    [allRows]
  );
  const renderedFiles = useMemo(() => {
    if (visibleFiles.length <= MAX_RENDERED_ROWS) return visibleFiles;
    const errors = visibleFiles.filter((f) => f.status === "error");
    const active = visibleFiles.filter((f) => f.status !== "error");
    return [...errors, ...active].slice(0, MAX_RENDERED_ROWS);
  }, [visibleFiles]);
  const hiddenRowCount = visibleFiles.length - renderedFiles.length;

  const overallPct = useMemo(() => {
    if (totalCount === 0) return 0;
    const inFlightSum = allRows.reduce(
      (acc, f) => acc + (f.status === "uploading" ? f.progress : 0),
      0
    );
    return Math.min(100, ((completedCount + inFlightSum / 100) / totalCount) * 100);
  }, [allRows, completedCount, totalCount]);

  const etaLabel = useMemo(() => {
    if (!speedMbps || speedMbps < 0.05) return null;
    let remaining = 0;
    for (const f of allRows) {
      if (f.status === "pending") remaining += f.file.size;
      else if (f.status === "uploading")
        remaining += f.file.size * (1 - f.progress / 100);
    }
    const secs = (remaining * 8) / 1e6 / speedMbps;
    if (!isFinite(secs) || secs <= 0) return null;
    if (secs < 90) return "~1 min left";
    const mins = Math.round(secs / 60);
    if (mins < 60) return `~${mins} min left`;
    return `~${Math.floor(mins / 60)}h ${mins % 60}m left`;
  }, [allRows, speedMbps]);

  // ─── Row-level actions ───
  const dropRow = useCallback(
    (row: Row) => {
      if (!row.batchId) setRejected((prev) => prev.filter((r) => r.id !== row.id));
      else removeFiles(row.batchId, new Set([row.id]));
    },
    [removeFiles]
  );

  const skipDuplicate = useCallback((row: Row) => dropRow(row), [dropRow]);

  const replaceDuplicate = useCallback(
    async (row: Row) => {
      if (row.existingImageIds?.length) {
        try {
          await fetch("/api/images/batch", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: row.existingImageIds }),
          });
        } catch {
          /* best-effort; upload still proceeds */
        }
      }
      updateFile(row.batchId, row.id, { status: "pending", progress: 0 });
      await uploadEntries(row.batchId, [{ ...row, status: "pending" }]);
    },
    [updateFile, uploadEntries]
  );

  const skipAllDuplicates = useCallback(() => {
    for (const b of myBatches) {
      const ids = new Set(
        b.files.filter((f) => f.status === "duplicate").map((f) => f.id)
      );
      if (ids.size) removeFiles(b.id, ids);
    }
  }, [myBatches, removeFiles]);

  const replaceAllDuplicates = useCallback(async () => {
    const allExisting = duplicateRows.flatMap((d) => d.existingImageIds ?? []);
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
    // Re-queue per batch, so each file returns to the section it was dropped on.
    for (const b of myBatches) {
      const dupes = b.files.filter((f) => f.status === "duplicate");
      if (!dupes.length) continue;
      dupes.forEach((d) => updateFile(b.id, d.id, { status: "pending", progress: 0 }));
      await uploadEntries(
        b.id,
        dupes.map((d) => ({ ...d, status: "pending" as FileStatus }))
      );
    }
  }, [duplicateRows, myBatches, updateFile, uploadEntries]);

  const retryRow = useCallback(
    async (row: Row) => {
      if (row.finalizeNeeded && row.imageId && row.batchId) {
        await retryFinalize(row.batchId, row);
        return;
      }
      if (row.imageId) {
        try {
          await fetch("/api/images/batch", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageIds: [row.imageId] }),
          });
        } catch {
          /* non-critical */
        }
      }
      const batch = myBatches.find((b) => b.id === row.batchId);
      dropRow(row);
      void startBatch({
        eventId,
        eventName: batch?.eventName ?? eventName ?? null,
        // Retries return to the section the file was originally dropped on.
        sectionId: batch?.sectionId ?? sectionId ?? null,
        sectionName: batch?.sectionName ?? sectionName ?? null,
        files: [row.file],
      });
    },
    [
      dropRow,
      eventId,
      eventName,
      myBatches,
      retryFinalize,
      sectionId,
      sectionName,
      startBatch,
    ]
  );

  const retryAllFailed = useCallback(async () => {
    const errors = allRows.filter((f) => f.status === "error");
    for (const row of errors) await retryRow(row);
  }, [allRows, retryRow]);

  const dismissErrors = useCallback(() => {
    setRejected([]);
    for (const b of myBatches) {
      const ids = new Set(
        b.files.filter((f) => f.status === "error").map((f) => f.id)
      );
      if (ids.size) removeFiles(b.id, ids);
    }
  }, [myBatches, removeFiles]);

  const cancelAll = useCallback(() => {
    for (const b of myBatches) cancelBatch(b.id);
  }, [myBatches, cancelBatch]);

  return (
    <div className="space-y-6">
      {unfinished.length > 0 && (
        <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3">
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[13px] font-medium text-amber-900">
              {unfinishedTotal.toLocaleString()}{" "}
              {unfinishedTotal === 1 ? "file" : "files"} didn&rsquo;t finish
              uploading last time
            </p>
            <p className="text-[12px] leading-relaxed text-amber-700">
              That session ended before these reached the archive. Drop them
              again to finish the job — anything that did make it will be caught
              as a duplicate, so re-adding the whole folder is safe.
            </p>
            <details className="pt-0.5">
              <summary className="cursor-pointer text-[12px] text-amber-800 underline underline-offset-2">
                Show filenames
              </summary>
              <ul className="mt-1.5 max-h-40 overflow-y-auto pr-2 font-mono text-[11px] leading-relaxed text-amber-800">
                {unfinished.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
              {unfinishedTotal > unfinished.length && (
                <p className="mt-1.5 text-[11px] text-amber-700">
                  Showing the first {unfinished.length.toLocaleString()} of{" "}
                  {unfinishedTotal.toLocaleString()}. Re-drop the whole folder —
                  everything already archived is caught as a duplicate.
                </p>
              )}
            </details>
          </div>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(
                  unfinishedDismissedKey(eventId),
                  String(unfinishedTotal)
                );
                localStorage.removeItem(unfinishedKey(eventId));
              } catch {
                /* nothing to clean up */
              }
              setUnfinished([]);
              setUnfinishedTotal(0);
            }}
            className="shrink-0 text-[12px] text-amber-700 underline underline-offset-2 hover:text-amber-900"
          >
            Dismiss
          </button>
        </div>
      )}

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
            {errorCount > 0 && ` · ${errorCount} failed`} — keep adding files, or
            switch sections and keep working
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
            {duplicateRows.slice(0, MAX_RENDERED_ROWS).map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 border-b border-amber-100/70 py-1.5 text-[13px] last:border-b-0"
              >
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-stone-100">
                  <FilePreview file={f.file} previewUrl={f.previewUrl} />
                </div>
                <span className="flex-1 truncate text-stone-700">
                  {f.file.name}
                </span>
                <button
                  onClick={() => replaceDuplicate(f)}
                  className="text-[12px] font-medium text-amber-900 hover:text-amber-700 transition-colors"
                >
                  Replace
                </button>
                <button
                  onClick={() => skipDuplicate(f)}
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
            {isUploading && speedMbps !== null && (
              <span className="shrink-0 text-[12px] tabular-nums text-stone-400 normal-case">
                {speedMbps >= 10 ? speedMbps.toFixed(0) : speedMbps.toFixed(1)}{" "}
                Mbps
                {etaLabel && <span className="text-stone-300"> · {etaLabel}</span>}
              </span>
            )}
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
                  onClick={cancelAll}
                  className="text-[12px] text-red-400 hover:text-red-600 transition-colors duration-300"
                >
                  Cancel
                </button>
              )}
              {!isUploading && errorCount > 0 && (
                <button
                  onClick={dismissErrors}
                  className="text-[12px] text-stone-400 hover:text-stone-700 transition-colors duration-300"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          <div className="max-h-[340px] space-y-px overflow-y-auto">
            {renderedFiles.map((f) => (
              <div
                key={f.id}
                className="relative flex items-center gap-3 border-b border-stone-100 px-0 py-2 text-[13px]"
              >
                {(f.status === "pending" || f.status === "uploading") && (
                  <span className="pointer-events-none absolute bottom-0 left-0 h-[2px] w-full bg-stone-200">
                    <span
                      className="block h-full bg-accent transition-[width] duration-200 ease-out"
                      style={{ width: `${f.progress}%` }}
                    />
                  </span>
                )}

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

                <span className="flex-1 truncate text-stone-600">
                  {f.file.name}
                </span>
                {/* Which section this file is bound for — only worth saying when
                    more than one batch is running for this event. */}
                {myBatches.length > 1 && f.batchSectionName && (
                  <span className="shrink-0 text-[11px] text-stone-300">
                    → {f.batchSectionName}
                  </span>
                )}
                <span className="shrink-0 text-[12px] text-stone-300">
                  {formatFileSize(f.file.size)}
                </span>

                {f.status === "error" && (
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="max-w-[180px] truncate text-[11px] text-red-400">
                      {f.error || "Upload failed"}
                    </span>
                    <button
                      onClick={() => retryRow(f)}
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
