"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { usePixelBurst } from "@/hooks/usePixelBurst";

type BrandColor = "blue" | "emerald" | "orange" | "red" | "navy" | "gold";

interface BrandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
  color?: BrandColor;
  /** Enable pixel burst confetti on click — use for rare celebration moments */
  celebrate?: boolean;
}

const COLOR_MAP: Record<
  BrandColor,
  { light: string; mid: string; dark: string; glow: string; glowHover: string }
> = {
  blue: {
    light: "#60A5FA",
    mid: "#3B82F6",
    dark: "#1E40AF",
    glow: "0 2px 0 rgba(30,64,175,0.5), 0 8px 24px rgba(59,130,246,0.25)",
    glowHover:
      "0 4px 0 rgba(30,64,175,0.4), 0 12px 32px rgba(59,130,246,0.35)",
  },
  emerald: {
    light: "#6EE7B7",
    mid: "#10B981",
    dark: "#065F46",
    glow: "0 2px 0 rgba(6,95,70,0.5), 0 8px 24px rgba(16,185,129,0.25)",
    glowHover:
      "0 4px 0 rgba(6,95,70,0.4), 0 12px 32px rgba(16,185,129,0.35)",
  },
  orange: {
    light: "#FDBA74",
    mid: "#F97316",
    dark: "#9A3412",
    glow: "0 2px 0 rgba(154,52,18,0.5), 0 8px 24px rgba(249,115,22,0.25)",
    glowHover:
      "0 4px 0 rgba(154,52,18,0.4), 0 12px 32px rgba(249,115,22,0.35)",
  },
  red: {
    light: "#FCA5A5",
    mid: "#EF4444",
    dark: "#991B1B",
    glow: "0 2px 0 rgba(153,27,27,0.5), 0 8px 24px rgba(239,68,68,0.25)",
    glowHover:
      "0 4px 0 rgba(153,27,27,0.4), 0 12px 32px rgba(239,68,68,0.35)",
  },
  navy: {
    light: "#475569",
    mid: "#1E293B",
    dark: "#020617",
    glow: "0 2px 0 rgba(2,6,23,0.5), 0 8px 24px rgba(30,41,59,0.25)",
    glowHover: "0 4px 0 rgba(2,6,23,0.4), 0 12px 32px rgba(30,41,59,0.35)",
  },
  gold: {
    light: "#FDE68A",
    mid: "#F59E0B",
    dark: "#92400E",
    glow: "0 2px 0 rgba(146,64,14,0.5), 0 8px 24px rgba(245,158,11,0.25)",
    glowHover:
      "0 4px 0 rgba(146,64,14,0.4), 0 12px 32px rgba(245,158,11,0.35)",
  },
};

const SIZE_CLASSES = {
  sm: "h-8 gap-1.5 px-4 text-[12px] uppercase tracking-[0.15em]",
  md: "h-10 gap-2 px-5 text-[13px] uppercase tracking-[0.12em]",
  lg: "h-12 gap-2.5 px-8 text-[13px] uppercase tracking-[0.15em]",
};

const BrandButton = forwardRef<HTMLButtonElement, BrandButtonProps>(
  (
    {
      className,
      size = "md",
      color = "blue",
      celebrate = false,
      onClick,
      children,
      style,
      ...props
    },
    forwardedRef
  ) => {
    const { ref: burstRef, burst } = usePixelBurst();
    const colors = COLOR_MAP[color];

    // Merge forwarded ref and burst ref
    const setRef = (el: HTMLButtonElement | null) => {
      burstRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (celebrate) burst(e);
      onClick?.(e);
    };

    return (
      <button
        ref={setRef}
        className={cn(
          "brand-btn inline-flex items-center justify-center font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
          SIZE_CLASSES[size],
          celebrate && "overflow-visible",
          className
        )}
        style={{
          background: colors.mid,
          boxShadow: colors.glow,
          ...style,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.boxShadow = colors.glowHover;
          props.onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.boxShadow = colors.glow;
          props.onMouseLeave?.(e);
        }}
        onClick={handleClick}
        {...props}
      >
        <span className="brand-band brand-band-1" style={{ background: colors.light }} />
        <span className="brand-band brand-band-2" style={{ background: colors.mid }} />
        <span className="brand-band brand-band-3" style={{ background: colors.dark }} />
        <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
      </button>
    );
  }
);

BrandButton.displayName = "BrandButton";
export { BrandButton };
export type { BrandButtonProps, BrandColor };
