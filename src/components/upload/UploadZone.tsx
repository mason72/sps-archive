"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Image as ImageIcon, CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import { cn, formatFileSize } from "@/lib/utils";
import { extractExif } from "@/lib/upload/parse-filename";

interface UploadFile {
  id: string;
  file: File;
  status: "pending" | "uploading" | "processing" | "complete" | "error";
  progress: number;
  error?: string;
  imageId?: string;
}

interface UploadZoneProps {
  eventId: string;
  onUploadComplete?: (imageIds: string[]) => void;
}

export function UploadZone({ eventId, onUploadComplete }: UploadZoneProps) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const newFiles: UploadFile[] = acceptedFiles.map((file, i) => ({
        id: `${Date.now()}-${i}`,
        file,
        status: "pending",
        progress: 0,
      }));

      setFiles((prev) => [...prev, ...newFiles]);
      setIsUploading(true);

      try {
        // 1. Get presigned URLs from our API
        const response = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId,
            files: acceptedFiles.map((f) => ({
              name: f.name,
              type: f.type,
              size: f.size,
            })),
          }),
        });

        if (!response.ok) throw new Error("Failed to get upload URLs");
        const { uploads } = await response.json();

        // 2. Upload files directly to R2 via presigned URLs
        const completedIds: string[] = [];

        await Promise.all(
          uploads.map(
            async (
              upload: { imageId: string; uploadUrl: string },
              index: number
            ) => {
              const file = acceptedFiles[index];
              const fileId = newFiles[index].id;

              try {
                setFiles((prev) =>
                  prev.map((f) =>
                    f.id === fileId ? { ...f, status: "uploading" } : f
                  )
                );

                // Upload to R2
                await fetch(upload.uploadUrl, {
                  method: "PUT",
                  body: file,
                  headers: { "Content-Type": file.type },
                });

                setFiles((prev) =>
                  prev.map((f) =>
                    f.id === fileId
                      ? { ...f, status: "processing", progress: 100 }
                      : f
                  )
                );

                // 3. Extract EXIF and notify server
                const arrayBuffer = await file.arrayBuffer();
                const exif = await extractExif(arrayBuffer);

                await fetch("/api/upload/complete", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    imageId: upload.imageId,
                    width: exif?.width,
                    height: exif?.height,
                    exif,
                  }),
                });

                setFiles((prev) =>
                  prev.map((f) =>
                    f.id === fileId
                      ? { ...f, status: "complete", imageId: upload.imageId }
                      : f
                  )
                );

                completedIds.push(upload.imageId);
              } catch (err) {
                setFiles((prev) =>
                  prev.map((f) =>
                    f.id === fileId
                      ? {
                          ...f,
                          status: "error",
                          error:
                            err instanceof Error
                              ? err.message
                              : "Upload failed",
                        }
                      : f
                  )
                );
              }
            }
          )
        );

        if (completedIds.length > 0) {
          onUploadComplete?.(completedIds);
        }
      } catch (err) {
        console.error("Upload error:", err);
      } finally {
        setIsUploading(false);
      }
    },
    [eventId, onUploadComplete]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/tiff": [".tiff", ".tif"],
      "image/webp": [".webp"],
      "image/heic": [".heic", ".heif"],
    },
    maxSize: 100 * 1024 * 1024, // 100MB per file
    disabled: isUploading,
  });

  const completedCount = files.filter((f) => f.status === "complete").length;
  const totalCount = files.length;

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all",
          isDragActive
            ? "border-stone-900 bg-stone-50"
            : "border-stone-300 hover:border-stone-400 hover:bg-stone-50/50",
          isUploading && "pointer-events-none opacity-60"
        )}
      >
        <input {...getInputProps()} />
        <Upload
          className={cn(
            "mb-3 h-10 w-10 transition-colors",
            isDragActive ? "text-stone-900" : "text-stone-400"
          )}
        />
        {isDragActive ? (
          <p className="text-lg font-medium text-stone-900">
            Drop images here
          </p>
        ) : (
          <>
            <p className="text-lg font-medium text-stone-700">
              Drag & drop images here
            </p>
            <p className="mt-1 text-sm text-stone-500">
              or click to browse. JPEG, PNG, TIFF, WebP, HEIC up to 100MB each.
            </p>
          </>
        )}
      </div>

      {/* Upload progress */}
      {files.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-stone-700">
              {isUploading
                ? `Uploading... ${completedCount}/${totalCount}`
                : `${completedCount} uploaded`}
            </span>
            {completedCount === totalCount && totalCount > 0 && (
              <button
                onClick={() => setFiles([])}
                className="text-stone-500 hover:text-stone-700"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-[300px] space-y-1 overflow-y-auto">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2 text-sm"
              >
                <ImageIcon className="h-4 w-4 shrink-0 text-stone-400" />
                <span className="flex-1 truncate text-stone-700">
                  {f.file.name}
                </span>
                <span className="shrink-0 text-stone-400">
                  {formatFileSize(f.file.size)}
                </span>
                {f.status === "uploading" && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-stone-500" />
                )}
                {f.status === "processing" && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />
                )}
                {f.status === "complete" && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                )}
                {f.status === "error" && (
                  <span title={f.error}>
                    <AlertCircle className="h-4 w-4 shrink-0 text-red-500" />
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
