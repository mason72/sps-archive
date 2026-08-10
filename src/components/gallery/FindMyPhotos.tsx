"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageUp, X } from "lucide-react";

/**
 * FindMyPhotos — guest selfie search modal (opt-in per event).
 *
 * Camera capture (getUserMedia) with a file-upload fallback; the image is
 * downscaled client-side to 800px JPEG before upload, embedded in memory
 * server-side, and never stored — the consent line can say so honestly.
 */
export function FindMyPhotos({
  slug,
  colors,
  onResults,
  onClose,
}: {
  slug: string;
  colors: { primary: string; secondary: string };
  onResults: (imageIds: string[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "camera" | "busy" | "none-found" | "no-face" | "error">(
    "choose"
  );
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1024 } },
        audio: false,
      });
      streamRef.current = stream;
      setMode("camera");
      // The video element mounts with the mode switch.
      requestAnimationFrame(() => {
        if (videoRef.current) videoRef.current.srcObject = stream;
      });
    } catch {
      setMode("error");
    }
  };

  const search = useCallback(
    async (base64: string) => {
      setMode("busy");
      try {
        const res = await fetch(`/api/gallery/${slug}/selfie-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
        });
        if (!res.ok) throw new Error(`selfie-search ${res.status}`);
        const data = (await res.json()) as { results: string[]; noFace?: boolean };
        if (data.noFace) {
          setMode("no-face");
          return;
        }
        if (!data.results.length) {
          setMode("none-found");
          return;
        }
        onResults(data.results);
      } catch {
        setMode("error");
      }
    },
    [slug, onResults]
  );

  /** Downscale to ≤800px JPEG and return raw base64 (no data: prefix). */
  const toBase64 = (source: HTMLVideoElement | HTMLImageElement): string => {
    const w = "videoWidth" in source ? source.videoWidth : source.naturalWidth;
    const h = "videoHeight" in source ? source.videoHeight : source.naturalHeight;
    const scale = Math.min(1, 800 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  };

  const captureFrame = () => {
    if (!videoRef.current) return;
    const b64 = toBase64(videoRef.current);
    stopCamera();
    search(b64);
  };

  const onFile = (file: File) => {
    const img = new Image();
    img.onload = () => search(toBase64(img));
    img.src = URL.createObjectURL(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-white p-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <h2 className="font-editorial text-2xl" style={{ color: colors.primary }}>
            Find my photos
          </h2>
          <button
            onClick={onClose}
            className="p-1 -mr-2 text-stone-300 hover:text-stone-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {mode === "choose" && (
          <>
            <p className="text-[13px] text-stone-500 mb-6 text-left leading-relaxed">
              Take a quick selfie and we&apos;ll pull up every photo you&apos;re in.
            </p>
            <div className="space-y-3">
              <button
                onClick={startCamera}
                className="w-full py-3 bg-stone-900 text-white text-[13px] tracking-wide hover:bg-stone-700 transition-colors inline-flex items-center justify-center gap-2"
              >
                <Camera className="h-4 w-4" /> Take a selfie
              </button>
              <label className="w-full py-3 border border-stone-300 text-stone-600 text-[13px] tracking-wide hover:border-stone-500 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer">
                <ImageUp className="h-4 w-4" /> Upload a photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
                />
              </label>
            </div>
            <p className="text-[11px] text-stone-400 mt-6 leading-relaxed">
              Your selfie is used once to match faces and is never stored.
            </p>
          </>
        )}

        {mode === "camera" && (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full aspect-square object-cover bg-stone-100 mb-4 -scale-x-100"
            />
            <button
              onClick={captureFrame}
              className="w-full py-3 bg-stone-900 text-white text-[13px] tracking-wide hover:bg-stone-700 transition-colors"
            >
              That&apos;s me — search
            </button>
          </>
        )}

        {mode === "busy" && (
          <p className="py-12 text-[13px] text-stone-400 italic animate-pulse">
            Looking for you…
          </p>
        )}

        {mode === "no-face" && (
          <RetryMessage onRetry={() => setMode("choose")}>
            We couldn&apos;t find a face in that photo — try again with your face
            centered and well lit.
          </RetryMessage>
        )}
        {mode === "none-found" && (
          <RetryMessage onRetry={() => setMode("choose")}>
            No matches in this gallery — you may not appear in these photos.
          </RetryMessage>
        )}
        {mode === "error" && (
          <RetryMessage onRetry={() => setMode("choose")}>
            Something went wrong. Please try again.
          </RetryMessage>
        )}
      </div>
    </div>
  );
}

function RetryMessage({
  children,
  onRetry,
}: {
  children: React.ReactNode;
  onRetry: () => void;
}) {
  return (
    <div className="py-8">
      <p className="text-[13px] text-stone-500 mb-6 leading-relaxed">{children}</p>
      <button
        onClick={onRetry}
        className="px-6 py-2.5 border border-stone-300 text-stone-600 text-[13px] hover:border-stone-500 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
