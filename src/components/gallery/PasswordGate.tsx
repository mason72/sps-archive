"use client";

import { useMemo, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GalleryBranding } from "@/types/gallery";

interface PasswordGateProps {
  slug: string;
  eventName: string;
  customMessage: string | null;
  branding?: GalleryBranding | null;
  /** True when /api/gallery/[slug]/cover will resolve — drives the backdrop. */
  hasCover?: boolean;
  /** Per-image dominant colors ("#RRGGBB"). Not image data — see the API. */
  palette?: string[];
  onSuccess: () => void;
}

/** Deterministic per-slug shuffle so the field looks the same on every visit. */
function seededOrder<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** max-min channel spread, 0–1. Cheap stand-in for chroma. */
function chroma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

/**
 * Pick the colors that will actually read as a backdrop.
 *
 * Dominant colors skew neutral — a gallery of headshots on white seamless
 * returns three dozen shades of off-white, and a field built from those is an
 * indistinguishable blank page. So: prefer the chromatic end of the palette,
 * and when a gallery genuinely has no color in it, fall back to the
 * photographer's brand rather than rendering nothing at all.
 */
function backdropColors(palette: string[], brand: string[]): string[] {
  const chromatic = palette
    .filter((hex) => chroma(hex) > 0.12)
    .sort((a, b) => chroma(b) - chroma(a))
    .slice(0, 6);
  if (chromatic.length >= 3) return chromatic;
  // Keep whatever color the gallery did have, topped up with brand hues.
  return [...chromatic, ...brand].slice(0, 5);
}

/**
 * PasswordGate — what a guest sees before they've earned a single pixel.
 *
 * The backdrop is deliberately NOT the real gallery behind a CSS blur: a
 * filter is one devtools toggle away from being no protection at all, and the
 * grid thumbnails never leave the server for an unauthenticated visitor. What
 * we can safely show is the cover image (already public — it's the hero of the
 * photographer's own email) blurred into an atmosphere, and failing that, a
 * drifting field built from the gallery's dominant colors. Either way the page
 * feels like the gallery it's guarding, and either way it gives nothing away.
 */
export function PasswordGate({
  slug,
  eventName,
  customMessage,
  branding: b,
  hasCover,
  palette = [],
  onSuccess,
}: PasswordGateProps) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);

  const bg = b?.backgroundColor || "#FFFFFF";
  const ink = b?.primaryColor || "#1C1917";
  const muted = b?.secondaryColor || "#78716C";
  const accent = b?.accentColor || "#10B981";

  const showCover = !!hasCover && !coverFailed;

  // Blobs for the color field. Nine is enough to read as a gallery's palette
  // without turning into confetti; the seed keeps the composition stable so a
  // guest retrying the password doesn't watch the page reshuffle under them.
  const blobs = useMemo(() => {
    const seed = slug
      .split("")
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 4294967296, 7);
    const colors = seededOrder(
      backdropColors(palette, [accent, ink, muted]),
      seed
    );
    return Array.from({ length: 9 }, (_, i) => ({
      color: colors[i % colors.length],
      top: `${[8, 4, 42, 68, 30, 74, 12, 55, 86][i]}%`,
      left: `${[6, 62, 30, 8, 82, 52, 38, 88, 20][i]}%`,
      size: `${[46, 52, 38, 50, 42, 48, 34, 44, 40][i]}vmax`,
      duration: `${26 + i * 5}s`,
      delay: `-${i * 3.5}s`,
    }));
  }, [palette, slug, ink, muted, accent]);

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
      className="relative min-h-screen overflow-hidden flex items-center justify-center px-6"
      style={{ backgroundColor: bg }}
    >
      {/* ─── Backdrop: color field ─── */}
      {/* Always rendered. Under a cover it's the bed the blur sits on (so the
          cover's soft edges never fade to bare white); without one it IS the
          backdrop. */}
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        {blobs.map((blob, i) => (
          <div
            key={i}
            className="gate-drift absolute rounded-full"
            style={{
              top: blob.top,
              left: blob.left,
              width: blob.size,
              height: blob.size,
              background: `radial-gradient(circle at 50% 50%, ${blob.color} 0%, ${blob.color}00 68%)`,
              opacity: showCover ? 0.28 : 0.72,
              filter: "blur(64px)",
              animation: `gate-drift ${blob.duration} ease-in-out ${blob.delay} infinite`,
              willChange: "transform",
            }}
          />
        ))}
      </div>

      {/* ─── Backdrop: blurred cover ─── */}
      {showCover && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/gallery/${slug}/cover`}
          alt=""
          aria-hidden="true"
          onError={() => setCoverFailed(true)}
          className="gate-breathe absolute inset-0 h-full w-full object-cover"
          style={{
            // 32px, not 56: past ~40 the cover stops being a soft-focus
            // photograph and becomes a flat wash, which is what made the
            // first pass read as an empty page with a card on it. The
            // saturation/contrast bump keeps colour alive through the blur.
            filter: "blur(32px) saturate(1.35) contrast(1.06)",
            // Scale past the viewport or the blur kernel pulls the page
            // background in around every edge as a bright halo.
            transform: "scale(1.15)",
            animation: "gate-breathe 34s ease-in-out infinite",
            willChange: "transform",
          }}
        />
      )}

      {/* ─── Scrim ─── */}
      {/* A vignette, not a veil. The card carries its own opaque backing and
          shadow, so the scrim only has to settle the edges into the gallery's
          background colour — flooding the middle is what erased the cover. */}
      <div
        className="absolute inset-0"
        aria-hidden="true"
        style={{
          background: showCover
            ? `radial-gradient(ellipse at 50% 45%, ${bg}33 0%, ${bg}1F 38%, ${bg}A6 100%)`
            : `radial-gradient(ellipse at 50% 45%, ${bg}99 0%, ${bg}66 45%, ${bg}CC 100%)`,
        }}
      />

      {/* ─── Card ─── */}
      <div className="reveal relative z-10 w-full max-w-sm">
        <div
          className="px-8 py-10 text-center backdrop-blur-xl"
          style={{
            // Opaque enough to be legible over ANY cover — including a
            // blown-out white one — without going flat against a dark one.
            backgroundColor: `${bg}F2`,
            border: `1px solid ${muted}2E`,
            boxShadow:
              "0 32px 80px -28px rgba(0,0,0,0.45), 0 2px 8px -2px rgba(0,0,0,0.12)",
          }}
        >
          {b?.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={b.logoUrl}
              alt={b.businessName || "Photographer"}
              className="mx-auto mb-7 h-10 w-auto object-contain"
            />
          ) : (
            <div
              className="mx-auto mb-6 flex h-10 w-10 items-center justify-center rounded-full"
              style={{ backgroundColor: `${accent}1A`, color: accent }}
            >
              <Lock size={16} strokeWidth={1.75} />
            </div>
          )}

          <h1
            className="font-editorial text-[clamp(26px,4vw,36px)] leading-[1.05] mb-2"
            style={{ color: ink }}
          >
            {eventName}
          </h1>

          <p className="caption-italic mb-8" style={{ color: muted }}>
            {customMessage || "This gallery is private"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Enter password"
              autoFocus
              autoComplete="off"
              aria-label="Gallery password"
              aria-invalid={!!error}
              className="w-full border-b bg-transparent py-3 text-center text-[16px] tracking-[0.12em] placeholder:tracking-normal placeholder:text-stone-300 focus:outline-none transition-colors duration-300"
              style={{
                borderColor: error ? "#dc2626" : `${muted}40`,
                color: ink,
              }}
            />

            {error && (
              <p className="fade-in text-[13px] text-red-600" role="alert">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={isVerifying || !password.trim()}
              className="w-full"
              style={{
                backgroundColor: accent,
                borderColor: accent,
                color: "#fff",
              }}
            >
              {isVerifying ? "Unlocking…" : "View gallery"}
            </Button>
          </form>

          <p className="mt-7 text-[11px]" style={{ color: `${muted}B3` }}>
            {b?.businessName
              ? `Ask ${b.businessName} if you need the password`
              : "Ask your photographer if you need the password"}
          </p>
        </div>
      </div>
    </div>
  );
}
