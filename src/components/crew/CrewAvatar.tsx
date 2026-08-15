"use client";

import { useState } from "react";

/**
 * A crew member's face, or their initials — never a broken image, never a
 * blank circle.
 *
 * Most of the roster will have no reference photo for a while (49 of 61 crew
 * are linked to no event at all), so the EMPTY state is the common state and
 * has to look deliberate: initials on stone, the same circle, the same size.
 * Mason: "we should still show an empty avatar if people don't have any
 * images."
 *
 * The crop math is the People view's `FaceCrop` idea: position the source
 * image inside a round window so the face box lands centered at about half the
 * tile. Two differences earned by the crew case:
 *
 *  - UPLOADED references have no stored pixel dimensions (the box is
 *    normalized, the file was never an `images` row), so the aspect ratio is
 *    measured from the loaded image itself (`onLoad`) instead of trusted from
 *    a column.
 *  - Any load failure falls back to initials — a reference whose presigned URL
 *    expired mid-session degrades to the empty state, not to a broken glyph.
 */

export interface CrewAvatarFace {
  url: string;
  bbox: { x: number; y: number; w: number; h: number } | null;
  imageWidth: number | null;
  imageHeight: number | null;
}

export function crewInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = words[0][0] ?? "";
  const last = words.length > 1 ? words[words.length - 1][0] ?? "" : "";
  return (first + last).toUpperCase() || "?";
}

export function CrewAvatar({
  face,
  name,
  size = 32,
  className = "",
}: {
  face: CrewAvatarFace | null | undefined;
  name: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);

  const dims =
    face?.imageWidth && face?.imageHeight
      ? { w: face.imageWidth, h: face.imageHeight }
      : measured;

  const showFace = face && !failed;

  let style: React.CSSProperties | null = null;
  if (showFace && face.bbox && dims) {
    const { w: W, h: H } = dims;
    const { x, y, w, h } = face.bbox;
    const winPx = Math.min(Math.max(w * W, h * H) * 2, Math.min(W, H));
    const widthPct = (W / winPx) * 100;
    const heightPct = (H / winPx) * 100;
    const cx = (x + w / 2) * W;
    const cy = (y + h / 2) * H;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    style = {
      width: `${widthPct}%`,
      height: `${heightPct}%`,
      left: `${clamp(50 - (cx / winPx) * 100, 100 - widthPct, 0)}%`,
      top: `${clamp(50 - (cy / winPx) * 100, 100 - heightPct, 0)}%`,
    };
  }

  return (
    <span
      className={`relative inline-block shrink-0 overflow-hidden rounded-full bg-stone-200 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {showFace ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={face.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          onLoad={(e) => {
            if (!face.imageWidth || !face.imageHeight) {
              const el = e.currentTarget;
              if (el.naturalWidth && el.naturalHeight) {
                setMeasured({ w: el.naturalWidth, h: el.naturalHeight });
              }
            }
          }}
          className={style ? "absolute max-w-none" : "absolute inset-0 h-full w-full object-cover"}
          style={style ?? undefined}
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center font-editorial text-stone-500"
          style={{ fontSize: Math.max(10, Math.round(size * 0.38)) }}
        >
          {crewInitials(name)}
        </span>
      )}
    </span>
  );
}
