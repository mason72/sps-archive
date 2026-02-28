"use client";

import { useEffect } from "react";
import { Footer } from "@/components/layout/Footer";

export default function GalleryErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Gallery error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col">
      <div className="flex-1 flex items-center justify-center px-8">
        <div className="text-center max-w-md">
          <h1 className="font-editorial text-[clamp(28px,4vw,48px)] text-stone-900">
            Gallery <span className="italic font-normal">unavailable</span>
          </h1>
          <p className="text-[14px] text-stone-400 mt-3">
            This gallery couldn&apos;t be loaded right now. Please try again in
            a moment.
          </p>

          <div className="mt-8">
            <button
              onClick={reset}
              className="text-[13px] text-stone-900 border border-stone-200 px-6 py-2.5 hover:bg-stone-50 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
