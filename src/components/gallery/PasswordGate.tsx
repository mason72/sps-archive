"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { GalleryBranding } from "@/types/gallery";

interface PasswordGateProps {
  slug: string;
  eventName: string;
  customMessage: string | null;
  branding?: GalleryBranding | null;
  onSuccess: () => void;
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
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsVerifying(true);
    setError(null);

    try {
      const res = await fetch(`/api/gallery/${slug}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Incorrect password");
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
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
              className="w-full border-b bg-transparent py-3 text-center text-[16px] placeholder:text-stone-300 focus:outline-none transition-colors duration-300"
              style={{
                borderColor: b?.secondaryColor ? `${b.secondaryColor}40` : undefined,
                color: b?.primaryColor,
              }}
            />
          </div>

          {error && (
            <p className="text-[13px] text-red-600 fade-in">{error}</p>
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
            {isVerifying ? "Verifying..." : "View gallery"}
          </Button>
        </form>

        {/* Photographer business name */}
        {b?.businessName && !b.logoUrl && (
          <p className="mt-12 text-[12px]" style={{ color: b.secondaryColor }}>
            {b.businessName}
          </p>
        )}
      </div>
    </div>
  );
}
