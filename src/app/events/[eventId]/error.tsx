"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function EventErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error("Event error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-8">
      <div className="text-center max-w-md">
        <h1 className="font-editorial text-[clamp(28px,4vw,48px)] text-stone-900">
          Event <span className="italic font-normal">unavailable</span>
        </h1>
        <p className="text-[14px] text-stone-400 mt-3">
          We couldn&apos;t load this event. It may have been removed or there
          was a temporary issue.
        </p>

        <div className="flex items-center justify-center gap-4 mt-8">
          <button
            onClick={reset}
            className="text-[13px] text-stone-900 border border-stone-200 px-6 py-2.5 hover:bg-stone-50 transition-colors"
          >
            Try again
          </button>
          <Link
            href="/"
            className="text-[13px] text-stone-400 hover:text-stone-600 transition-colors"
          >
            Back to dashboard
          </Link>
        </div>

        <div className="mt-12">
          <button
            onClick={() => setShowDetails((v) => !v)}
            className="text-[12px] text-stone-300 hover:text-stone-400 transition-colors"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && (
            <pre className="mt-3 text-left text-[11px] text-stone-400 bg-stone-50 border border-stone-100 rounded p-4 overflow-x-auto max-h-48 overflow-y-auto">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
