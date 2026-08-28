"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Share2, X } from "lucide-react";
import { toast } from "sonner";

/**
 * The link a guest just minted (or is passing along), ready to send.
 *
 * One rule from Mason (2026-08-28): this dialog may say a password EXISTS —
 * "anyone with this link will need the gallery password" — but never what it
 * is. The owner may have shared the gallery while withholding the PIN; the
 * door gets described, the key stays with whoever holds it.
 */
export function ShareLinkDialog({
  title,
  subtitle,
  url,
  passwordProtected,
  colors,
  headingClass,
  onClose,
}: {
  /** e.g. "Share Amanda's photos" or the event name. */
  title: string;
  /** e.g. "12 photos" — context under the heading. */
  subtitle: string | null;
  url: string;
  passwordProtected: boolean;
  colors: { primary: string; secondary: string; accent: string; background: string };
  headingClass: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // navigator.share only exists on secure contexts + supporting browsers
  // (mostly mobile). Resolved in an effect so SSR and hydration agree.
  const [canNativeShare, setCanNativeShare] = useState(false);
  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fall back to selecting the text so a manual ⌘C still works.
      inputRef.current?.select();
      toast.error("Couldn't copy — the link is selected, copy it yourself");
    }
  };

  const nativeShare = async () => {
    try {
      await navigator.share({ title, url });
    } catch {
      // Cancelled the sheet — not an error worth reporting.
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: "rgba(12,10,9,0.45)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md border bg-white p-6 shadow-[0_16px_48px_-16px_rgba(12,10,9,0.35)]"
        style={{ borderColor: `${colors.secondary}25` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2
              className={`${headingClass} text-[clamp(18px,2.5vw,24px)] leading-tight`}
              style={{ color: colors.primary }}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className="mt-1 text-[11px] uppercase tracking-[0.18em] tabular-nums"
                style={{ color: colors.secondary }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 p-1 transition-opacity hover:opacity-60"
            style={{ color: colors.secondary }}
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div
          className="mt-5 flex items-stretch border"
          style={{ borderColor: `${colors.secondary}30` }}
        >
          <input
            ref={inputRef}
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Share link"
            className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-[12px] focus:outline-none"
            style={{ color: colors.primary }}
          />
          <button
            type="button"
            onClick={copy}
            className="flex shrink-0 items-center gap-1.5 border-l px-3.5 text-[13px] transition-colors hover:bg-stone-50"
            style={{ color: colors.primary, borderColor: `${colors.secondary}30` }}
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={1.5} style={{ color: colors.accent }} />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
                Copy
              </>
            )}
          </button>
        </div>

        {canNativeShare && (
          <button
            type="button"
            onClick={nativeShare}
            className="mt-3 flex w-full items-center justify-center gap-2 border px-4 py-2.5 text-[13px] transition-colors hover:bg-stone-50"
            style={{ color: colors.primary, borderColor: `${colors.secondary}30` }}
          >
            <Share2 className="h-4 w-4" strokeWidth={1.5} />
            Share…
          </button>
        )}

        {passwordProtected && (
          <p className="mt-4 text-[12px] leading-[1.6]" style={{ color: colors.secondary }}>
            This gallery is password protected — anyone you send this to will
            need the gallery password too.
          </p>
        )}
      </div>
    </div>
  );
}
