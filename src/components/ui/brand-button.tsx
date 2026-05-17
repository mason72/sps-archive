"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { usePixelBurst } from "@/hooks/usePixelBurst";

/**
 * The product's single accent CTA color. Earlier iterations exposed six
 * (blue / emerald / orange / red / navy / gold) which photographers and
 * clients saw shift hue depending on which page they were on — the
 * loudest brand-coherence break in the audit. The `color` prop is kept
 * for backwards compatibility but only "emerald" is honoured; any other
 * value silently maps to emerald.
 */
type BrandColor = "emerald";

interface BrandButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md" | "lg";
  /** @deprecated Only "emerald" is supported. The prop survives so existing
   *  call sites compile without churn. */
  color?: string;
  /** Enable pixel burst confetti on click — use for rare celebration moments */
  celebrate?: boolean;
}

const EMERALD = {
  light: "#6EE7B7",
  mid: "#10B981",
  dark: "#065F46",
  glow: "0 2px 0 rgba(6,95,70,0.5), 0 8px 24px rgba(16,185,129,0.25)",
  glowHover:
    "0 4px 0 rgba(6,95,70,0.4), 0 12px 32px rgba(16,185,129,0.35)",
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
      celebrate = false,
      onClick,
      children,
      style,
      // Intentionally destructured + discarded for back-compat.
      color: _color,
      ...props
    },
    forwardedRef
  ) => {
    void _color;
    const { ref: burstRef, burst } = usePixelBurst();
    const colors = EMERALD;

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
