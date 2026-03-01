"use client";

import { useRef, useCallback } from "react";

const ELEPHANT_COLORS = [
  "#E74C3C", "#E67E22", "#F1C40F", "#2ECC71",
  "#1ABC9C", "#3498DB", "#8E44AD", "#2C5FA8",
];

/**
 * Pixel Burst — mosaic confetti on click.
 * 16 tiny colored squares explode outward from the click point.
 * Use sparingly for celebration moments (publish, create, share).
 */
export function usePixelBurst() {
  const ref = useRef<HTMLButtonElement>(null);

  const burst = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = ref.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (let i = 0; i < 16; i++) {
      const pixel = document.createElement("div");
      const size = 3 + Math.random() * 5;
      const color =
        ELEPHANT_COLORS[Math.floor(Math.random() * ELEPHANT_COLORS.length)];
      const angle = (Math.PI * 2 * i) / 16 + (Math.random() - 0.5) * 0.5;
      const distance = 30 + Math.random() * 50;
      const dx = Math.cos(angle) * distance;
      const dy = Math.sin(angle) * distance;

      Object.assign(pixel.style, {
        position: "absolute",
        left: `${x}px`,
        top: `${y}px`,
        width: `${size}px`,
        height: `${size}px`,
        background: color,
        borderRadius: "1px",
        pointerEvents: "none",
        zIndex: "50",
        transition: "all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        opacity: "1",
      });
      btn.appendChild(pixel);

      requestAnimationFrame(() => {
        pixel.style.transform = `translate(${dx}px, ${dy}px) rotate(${Math.random() * 360}deg)`;
        pixel.style.opacity = "0";
      });
      setTimeout(() => pixel.remove(), 600);
    }
  }, []);

  return { ref, burst };
}
