"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GalleryBranding } from "@/types/gallery";

interface PasswordGateProps {
  slug: string;
  eventName: string;
  customMessage: string | null;
  branding?: GalleryBranding | null;
  onSuccess: () => void;
}

/** Format a Retry-After value (seconds string, or HTTP-date) as a human
 *  "X minutes" line. Rounds up so we never tell the user "0 minutes". */
function formatRetryAfter(value: string | null): string | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes === 1) return "Try again in about a minute.";
  if (minutes < 60) return `Try again in about ${minutes} minutes.`;
  const hours = Math.round(minutes / 60);
  return `Try again in about ${hours} hour${hours === 1 ? "" : "s"}.`;
}

/**
 * PasswordGate — Password entry form for protected galleries.
 * Renders photographer branding when available.
 */
export function PasswordGate({
  slug,
  eventName,
  customMessage,
  branding: b,
  onSuccess,
}: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryHint, setRetryHint] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsVerifying(true);
    setError(null);
    setRetryHint(null);

    try {
      const res = await fetch(`/api/gallery/${slug}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        // Honor the Retry-After header on 429s so the user gets a
        // concrete "try again in N minutes" instead of just a vague
        // scary "too many attempts."
        if (res.status === 429) {
          setError("Too many attempts.");
          setRetryHint(formatRetryAfter(res.headers.get("Retry-After")));
        } else {
          const data = await res.json().catch(() => ({}));
          setError(data.error || "Incorrect password");
        }
        return;
      }

      onSuccess();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-8"
      style={{ backgroundColor: b?.backgroundColor }}
    >
      <div className="w-full max-w-sm text-center">
        {/* Photographer logo */}
        {b?.logoUrl && (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={b.logoUrl}
            alt={b.businessName || "Photographer"}
            className="h-10 w-auto object-contain mx-auto mb-8"
          />
        )}

        <h1
          className="font-editorial text-[clamp(28px,4vw,40px)] leading-[0.95] mb-2"
          style={{ color: b?.primaryColor }}
        >
          {eventName}
        </h1>
        {customMessage && (
          <p className="caption-italic mb-8" style={{ color: b?.secondaryColor }}>
            {customMessage}
          </p>
        )}
        {!customMessage && (
          <p className="caption-italic mb-8" style={{ color: b?.secondaryColor }}>
            This gallery is protected
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              autoComplete="current-password"
              className="w-full border-b bg-transparent py-3 pr-9 text-center text-[16px] placeholder:text-stone-300 focus:outline-none transition-colors duration-300"
              style={{
                borderColor: b?.secondaryColor ? `${b.secondaryColor}40` : undefined,
                color: b?.primaryColor,
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              tabIndex={-1}
              className="absolute right-0 top-1/2 -translate-y-1/2 p-1.5 opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: b?.secondaryColor }}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          {error && (
            <div className="space-y-1 fade-in">
              <p className="text-[13px] text-red-600">{error}</p>
              {retryHint && (
                <p className="text-[12px] text-stone-500">{retryHint}</p>
              )}
            </div>
          )}

          <Button
            type="submit"
            disabled={isVerifying}
            className="w-full"
            style={
              b?.accentColor
                ? {
                    backgroundColor: b.accentColor,
                    borderColor: b.accentColor,
                    color: "#fff",
                  }
                : undefined
            }
          >
            {isVerifying ? "Verifying…" : "View gallery"}
          </Button>
        </form>

        <p
          className="mt-10 text-[11px] opacity-60 leading-relaxed"
          style={{ color: b?.secondaryColor }}
        >
          If you&apos;ve lost the password, ask your photographer to
          resend the link.
        </p>

        {/* Photographer business name */}
        {b?.businessName && !b.logoUrl && (
          <p
            className="mt-6 text-[12px]"
            style={{ color: b.secondaryColor }}
          >
            {b.businessName}
          </p>
        )}
      </div>
    </div>
  );
}
