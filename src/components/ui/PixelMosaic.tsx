/**
 * The pixel-mosaic mark — small ornament inspired by the elephant logo's
 * pattern. Pure SVG using currentColor + per-cell opacity so it inherits
 * whatever text color the surrounding element sets.
 *
 * The same mark appears as the favicon and in the public gallery footer
 * ("Powered by pixeltrunk"); use this component anywhere a tiny branded
 * ornament adds warmth without competing with content.
 *
 *   <PixelMosaic size={16} />                  // default opacity 40%
 *   <PixelMosaic size={48} className="text-stone-300 opacity-100" />
 */

import { cn } from "@/lib/utils";

// 4×4 grid of opacities — eye-checked for a balanced cloud of tones.
const TILES: number[] = [
  0.3, 0.6, 0.4, 0.2,
  0.5, 0.9, 0.7, 0.3,
  0.4, 0.7, 0.8, 0.5,
  0.2, 0.4, 0.5, 0.9,
];

interface Props {
  size?: number;
  className?: string;
}

export function PixelMosaic({ size = 16, className }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={cn("opacity-40", className)}
      aria-hidden="true"
    >
      {TILES.map((opacity, i) => {
        const col = i % 4;
        const row = Math.floor(i / 4);
        return (
          <rect
            key={i}
            x={col * 4}
            y={row * 4}
            width={4}
            height={4}
            rx={0.5}
            fill="currentColor"
            opacity={opacity}
          />
        );
      })}
    </svg>
  );
}
