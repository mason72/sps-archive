"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ElephantWalk } from "@/components/brand/ElephantWalk";
import { Camera, ImageUp, X } from "lucide-react";

/**
 * FindMyPhotos — guest selfie search modal (on by default per event).
 *
 * Camera capture (getUserMedia) with a file-upload fallback; the image is
 * downscaled client-side to 800px JPEG before upload, embedded in memory
 * server-side, and never stored — the consent line can say so honestly.
 */
export function FindMyPhotos({
  apiBase,
  colors,
  onResults,
  onClose,
}: {
  /** Gallery API base — `/api/gallery/<slug>` or the preview equivalent. */
  apiBase: string;
  colors: { primary: string; secondary: string };
  onResults: (imageIds: string[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<
    "choose" | "camera" | "no-camera" | "busy" | "none-found" | "no-face" | "bad-image" | "error"
  >("choose");
  // Why the camera didn't open, for the "no-camera" screen.
  const [cameraBlocked, setCameraBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Wake the face detector the moment the sheet opens. A cold GPU takes ~24 s
  // (measured 2026-10-28) and a warm one about a second, so this lets the
  // load run while the guest lines up the selfie. Fire and forget: the
  // server skips it when the detector is already warm, and a failed ping
  // only means the search pays the cold start itself.
  useEffect(() => {
    fetch(`${apiBase}/selfie-search/warm`, { method: "POST", keepalive: true }).catch(
      () => {}
    );
  }, [apiBase]);

  // Fixed overlay: freeze the page behind the modal.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    // No mediaDevices at all: an in-app browser (Instagram, LinkedIn) or a
    // non-https page. Calling it would throw a TypeError that read as
    // "Something went wrong" — say what happened and offer the upload.
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraBlocked(false);
      setMode("no-camera");
      return;
    }
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
    } catch (err) {
      // NotAllowedError: the guest (or the browser's settings) said no, and
      // asking again won't re-prompt. Anything else: no camera, or another
      // app holds it. Either way the upload still works.
      const name = err instanceof DOMException ? err.name : "";
      setCameraBlocked(name === "NotAllowedError" || name === "SecurityError");
      setMode("no-camera");
    }
  };

  const search = useCallback(
    async (base64: string) => {
      setMode("busy");
      try {
        const res = await fetch(`${apiBase}/selfie-search`, {
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
    [apiBase, onResults]
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
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      search(toBase64(img));
    };
    // A format this browser can't decode (HEIC outside Safari) never fires
    // onload; without this the modal just sat on the chooser.
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setMode("bad-image");
    };
    img.src = url;
  };

  // The upload control, shared by the chooser and the no-camera screen
  // (where it is the primary action). The value is cleared after each pick
  // so choosing the same photo again still fires onChange.
  const uploadButton = (primary: boolean) => (
    <label
      className={
        primary
          ? "w-full py-3 bg-stone-900 text-white text-[13px] tracking-wide hover:bg-stone-700 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
          : "w-full py-3 border border-stone-300 text-stone-600 text-[13px] tracking-wide hover:border-stone-500 transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
      }
    >
      <ImageUp className="h-4 w-4" /> {primary ? "Upload a selfie" : "Upload a photo"}
      <input
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );

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
            aria-label="Close"
            className="p-1 -mr-2 text-stone-300 hover:text-stone-600 transition-colors pointer-coarse:-my-1.5 pointer-coarse:-mr-3.5 pointer-coarse:p-2.5"
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
              {uploadButton(false)}
            </div>
            <p className="text-[11px] text-stone-400 mt-6 leading-relaxed">
              Your selfie is used once to match faces and is never stored.
            </p>
          </>
        )}

        {mode === "no-camera" && (
          <div className="py-6">
            <p className="text-[13px] text-stone-500 mb-6 leading-relaxed">
              {cameraBlocked
                ? "Camera is blocked here. Upload a selfie instead."
                : "Couldn't open a camera here. Upload a selfie instead."}
            </p>
            {uploadButton(true)}
            <button
              onClick={() => setMode("choose")}
              className="mt-3 w-full py-2.5 text-[13px] text-stone-500 hover:text-stone-800 transition-colors"
            >
              Back
            </button>
          </div>
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

        {/* The longest wait a GUEST ever sits through here: their selfie goes
            to the GPU, gets embedded, then votes for a person cluster. It's
            also the most emotionally loaded — they're waiting to see
            themselves — so an animated wait beats a pulsing line of text. */}
        {mode === "busy" && (
          <div className="py-6">
            <ElephantWalk
              className="mx-auto max-w-[300px]"
              message="Looking for you…"
              detail="Your selfie is never stored — it's used once to find your face."
            />
          </div>
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
        {mode === "bad-image" && (
          <RetryMessage onRetry={() => setMode("choose")}>
            We couldn&apos;t open that photo. Try a different one.
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
